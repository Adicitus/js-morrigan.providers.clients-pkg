const { DateTime } = require('luxon')
const TokenGenerator = require('@adicitus/jwtgenerator')


var clientRecords = null
var tokenRecords = null
var tokens = null

var log = null

async function getClient(clientId) {
    return await clientRecords.findOne({ id: clientId })
}

async function getClients() {
    return await clientRecords.find().toArray()
}

/**
 * Provisions resources for a client with the given clientId.
 * 
 * Calling this function with the ID of an existing client will cause the
 * existing token to be replaced with a new one.
 * 
 * This function returns an object containing a token that the client should
 * use when connecting via WebSocket, the ID of the token and the the token's
 * expiration date/time.
 * 
 * @param {string} clientId - ID to setup client resources for.
 * @returns {string} Client authentication token. 
 */
async function provisionClient(clientId){

    let client = await getClient(clientId)

    let record = null

    if (client) {
        record = client
    } else {
        record = {
            id: clientId,
            created: DateTime.now()
        }
        await clientRecords.insertOne(record)
    }

    let t = await tokens.newToken(clientId)

    record.tokenId = t.record.id
    record.updated = DateTime.now()

    clientRecords.replaceOne({id: record.id}, record)

    return t.token

}

/**
 * Removes any resources associated with the given clientId.
 * 
 * This will invalidate the clients authentication token.
 * @param {string} clientId ID of the client to deprovision.
 * @returns True if a client was deprovisioned, false otherwise.
 */
async function deprovisionClient(clientId) {
    let client = await getClient(clientId)

    if (!client) {
        return false
    }

    await clientRecords.deleteOne({id: client.id})

    if (client.tokenId) {
        await tokenRecords.deleteOne({id: client.tokenId})
    }

    return true
}

/**
 * Attempts to verify the validity of a token.
 * 
 * Will return a object with a 'state' field and a data field.
 * 
 * If verification was successful, the state will be 'success' and the object
 * will contain a field 'client' with the client specified by the token.
 * 
 * If verification was unsuccessful, there will be a 'reason' with a short
 * description of what went wrong.
 * 
 * @param {string} token - The token to verify.
 */
async function verifyToken(token) {

    let r = await tokens.verifyToken(token)

    if (r.success) {
        let client = await getClient(r.subject)
        return { state: 'success', client: client }
    }

    return { state: 'authenticationfailed', status: r.status, reason: r.reason }
}

module.exports.verifyToken      = verifyToken
module.exports.provisionClient  = provisionClient
module.exports.deprovisionClient= deprovisionClient
module.exports.getClient        = getClient

/* =========== Start Endpoint Definition ============== */

/**
 * Client provisioning endpoint handler.
 * 
 * Accepts a application/json body with a single field called 'id', which
 * should contain the value to be used as the Client ID of the new client.
 * @param {Object} req Request object.
 * @param {Object} res Response object.
 */
async function ep_provisionClient(req, res) {

    let details = req.body
    
    log(`Provisioning client '${details.id}' for ${req.authenticated.name}`)

    let t = await provisionClient(details.id)

    res.status(200)
    res.send(JSON.stringify(t))
}

/**
 * GET Client endpoint handler.
 * 
 * Accepts a client ID as a request parameter, and if this is provided then
 * only that client will be returned.
 * 
 * Returns status code 204 if a client ID was specified but no such client exists.
 * 
 * Returns status code 200 if there is client data to return.
 * @param {Object} req Request object.
 * @param {Object} res Response object.
 */
async function ep_getClients(req, res) {

    if (req.params) {

        let params = req.params

        if (params.clientId) {
            let c = await getClient(params.clientId)
            if (c) {
                res.status(200)
                res.send(JSON.stringify(c))
                return
            } else {
                res.status(204)
                res.end()
                return
            }
        }

    }

    res.status(200)
    res.send(JSON.stringify(await getClients()))
}

/**
 * Client deprovisioning endpoint handler.
 * 
 * Expects a client ID as a request parameter. If such a client exists,
 * it will be removed.
 * 
 * Returns status code 400 if no client ID is provided.
 * 
 * Returns 200 if a client was removed.
 * 
 * Returns 204 if no client exists on the server.
 * @param {Object} req Request object.
 * @param {Object} res Response object.
 */
async function ep_deprovisionClient(req, res) {
    if (!req.params || !req.params.clientId) {
        res.status(400)
        res.send('No client ID provided.')
    }

    deprovisionClient(req.params.clientId).then(o => {
        if (o) {
            res.status(200)
            res.end()
        } else {
            res.status(204)
            res.end()
        }
    }).catch(e => {
        res.status(500)
        res.end()
    })
}

module.exports.name = 'client'

module.exports.endpoints = [
    
    {route: '/provision', method: 'post', handler: ep_provisionClient, openapi: {
        description: "Provisions a client entry on the system.",
        post: {
            tags: ['Client', 'Client Lifecycle'],
            summary: "Provisions a new client entry for the given client ID.",
            operationId: 'morrigan.server.providers.client.provision.post',
            requestBody: {
                description: "Should contain the ID of the client to provision.",
                content: {
                    "application/json": {
                        schema: {
                            type: 'object',
                            required: [
                                'id'
                            ],
                            properties: {
                                id: {
                                    type: 'string'
                                }
                            }
                        },
                        examples: {
                            uuid: {
                                summary: "UUID",
                                value: {
                                    id: "9f39ea0c-610b-494e-a2f1-65faa5b75dc6"
                                }
                            },
                            freetext: {
                                summary: "Freetext",
                                value: {
                                    id: "MyComputer"
                                }
                            }
                        }
                    }
                },
                required: true
            },
            responses: {
                200: {
                    description: "Successfully provisioned the client ID.",
                    content: {
                        "text/plain": {
                            schema: {
                                type: "string",
                                description: "Identity token (JWT) for the given ID."
                            },
                            example: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjZhNDlkYjhkLWMxM2MtNDVjOS1hMDE4LWQ5Yjg3MDY2OWFhYSJ9.eyJzdWIiOiI5ZjM5ZWEwYy02MTBiLTQ5NGUtYTJmMS02NWZhYTViNzVkYzYiLCJpc3MiOiJkZWQ3NGUyNC1lYzZhLTRkNzYtYWU2My03ZDc1NzE2M2VhOWQiLCJpYXQiOjE2NTkwODQzNDIsImV4cCI6MTY2MTY3NjM0Mn0.AAAAAIeTWWUi9AzCbVRqC3H0oT2H-ZYC-5to_zJE_g8AAAAAIPzPOxBZ8qhFVhAaLKOgA-CEN0352LNmhWqVzQ"
                        }
                    }
                }
            }
        }
    }},
    {route: '/', method: 'get', handler: ep_getClients, openapi: {
        get: {
            tags: ['Client'],
            summary: "Retrieve all clients.",
            operationId: 'morrigan.server.providers.client.get',
            responses: {
                200: {
                    description: "An array of all clients registered in the system.",
                    content: {
                        "application/json": {
                            schema: {
                                type: 'array',
                                items: {
                                    $ref: '#/components/schemas/clientRecord'
                                }
                            }
                        }
                    }
                }
            }
        }
    }},
    {route: '/:clientId', method: 'get', handler: ep_getClients, openapi: {
        get: {
            tags: ['Client'],
            summary: "Retrieve a specific client.",
            operationId: 'morrigan.server.providers.client.get.byClientId',
            parameters: [
                {
                    name: 'clientId',
                    in: 'path',
                    required: true,
                    description: "The ID of the client to retrieve.",
                    schema: {
                        type: 'string',
                    }
                }
            ],
            responses: {
                200: {
                    description: "A single client matching the specified ID.",
                    content: {
                        "application/json": {
                            schema: {
                                type: 'array',
                                items: {
                                    $ref: '#/components/schemas/clientRecord'
                                }
                            }
                        }
                    }
                },
                404: {
                    description: "No such client exists."
                }
            }
        }
    }},
    {route: '/:clientId', method: 'delete', handler: ep_deprovisionClient, openapi: {
        delete: {
            tags: ['Client', 'Client Lifecycle'],
            summary: "Deprovisions the given client, removing it from the system and preventing further connections.",
            operationId: 'morrigan.server.providers.client.provision.post',
            parameters: [
                {
                    name: 'clientId',
                    in: 'path',
                    required: true,
                    description: "The ID of the client to delete.",
                    schema: {
                        type: 'string',
                    }
                }
            ],
            responses: {
                200: {
                    description: "The indicated client was removed."
                },
                204: {
                    description: "No such client exists."
                }
            }
        }
    }}
]

module.exports.openapi = {
    components: {
        schemas: {
            clientRecord: {
                type: 'object',
                required: [
                    'id'
                ],
                properties: {
                    _id: {
                        type: 'string',
                        readOnly: true,
                        description: "Internal ID of the client."
                    },
                    id: {
                        type: 'string',
                        minLength: 1,
                        description: "Assigned ID of the client."
                    },
                    created: {
                        type: 'string',
                        readOnly: true,
                        description: "Datetime when this client was provisioned."
                    },
                    updated: {
                        type: 'string',
                        readOnly: true,
                        description: "Datetime when this client was last updated."
                    },
                    tokenId: {
                        type: 'string',
                        readOnly: true,
                        description: "ID of the token corresponding to this client."
                    }
                },
                example: `{    
                    "_id":  "62e39e36276f5f01b88dee83",
                    "id":  "9f39ea0c-610b-494e-a2f1-65faa5b75dc6",                                                                                                                                                      "_id":  "62e39e36276f5f01b88dee83",                                                                                                                    "id":  "9f39ea0c-610b-494e-a2f1-65faa5b75dc6",
                    "created":  "2022-07-29T08:45:42.826Z",
                    "tokenId":  "6a49db8d-c13c-45c9-a018-d9b870669aaa",
                    "updated":  "2022-07-29T08:45:42.856Z"
                }`
            }
        }
    }
}

module.exports.messages = {
    /**
     * The client is asking for a refreshed token, respond wiht client.token.issue
     * containing a newly provisioned token.
     */
    'token.refresh': async (message, connection, record, core) => {
        core.log(`Client ${record.clientId} requested a new token.`)
        let r = await tokens.newToken(record.clientId)
        connection.send(JSON.stringify({
            type: 'client.token.issue',
            token: r.token,
            expires: r.record.expires.toISO()
        }))
    },

    'state': async (message, connection, record, core) => {
        let providers = core.providers
        core.log(`Client ${record.clientId} reported state: ${message.state}`)
        let client = await providers.client.getClient(record.clientId)
        client.state = message.state
    }
}

module.exports.setup = async (coreEnv) => {
    log = coreEnv.log

    clientRecords = coreEnv.db.collection('morrigan.clients')
    tokenRecords  = coreEnv.db.collection('morrigan.clients.tokens')
    tokens = new TokenGenerator({
        id: coreEnv.serverInfo.id,
        collection: tokenRecords,
        tokenLifetime: { days: 30 },
        keyLifetime: { hours: 8 }
    })
}