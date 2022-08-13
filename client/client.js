const fs = require('fs')

var tokenPath = null
var tokenExpirationPath = null
var token = null
var tokenExpires = null
var tokenRefreshInterval

const loadToken = () => {
    try {
        token = fs.readFileSync(tokenPath)

        if (fs.existsSync(tokenExpirationPath)) {
            tokenExpires = fs.readFileSync(tokenExpirationPath)
        }
        return true
    } catch (e) {
        return false
    }
}

const saveToken = () => {
    fs.writeFileSync(tokenPath, token)
    if (tokenExpires) { 
        fs.writeFileSync(tokenExpirationPath, tokenExpires)
    }
}

module.exports.name = 'client'

module.exports.getToken = () => {
    return token
}

module.exports.setup = (core) => {
    
    tokenPath = `${core.stateDir}/token`
    tokenExpirationPath = `${core.stateDir}/token.expiration`

    if (!fs.existsSync(tokenPath) || (core.args && core.args.force && (core.args.token || core.args.tokenFile))) {
        if (core.args.token) {
            token = core.args.token
        } else if (core.args.tokenFile && fs.existsSync(core.args.tokenFile)) {
            token = fs.readFileSync(core.args.tokenFile, {encoding: 'utf8'})
        } else if(core.settings.token) {
            token = core.settings.token
        } else {
            throw new Error('No token set provided.')
        }
        
        saveToken()
    } else {

        if (core.args && (core.args.token || core.args.tokenFile)) {
            console.log('A token was specified on the command line, but there is already a token installed, the existing token will be used.')
            console.log('To install the new token, use the --force parameter.')
        }

        loadToken()
    }

}

module.exports.onConnect = (connection) => {
    console.log('Connection opened.')

    // Immediately request a new token:
    connection.send(JSON.stringify(
        { type: 'client.token.refresh' }
    ))

    // Request new tokens every 8 hours:
    tokenRefreshInterval = setInterval(() => {
        connection.send(JSON.stringify(
            { type: 'client.token.refresh' }
        ))
    }, (8 * 3600 * 1000) )

}

module.exports.onDisconnect = () => {
    console.log('Connection closed.')
    if (tokenRefreshInterval) {
        clearImmediate(tokenRefreshInterval)
    }
}

module.exports.messages = {
    'token.issue': (message) => {
        console.log(`${new Date()} | New token issued (expires ${message.expires}).`)
        token = message.token
        tokenExpires = message.expires
        saveToken()
    }
}
