import cwd from 'cwd'
import { join } from 'path'
import _ from 'lodash'

let importEnvVars = (collection, prefix) => {
  _.forOwn(collection, (value, key) => {
    let envKey = `${prefix}_${key.toUpperCase().replace(/[^a-z0-9_]+/gi, '_')}`
    let envVal = process.env[envKey]

    if (_.isNumber(value) || _.isString(value) || _.isBoolean(value) || value == null) {
      if (envVal && _.isString(envVal)) {
        if (/^\s*\$\w/.test(envVal)) envVal = process.env[envVal.trim().substr(1)]
        if (/^\s*\d+\s*$/i.test(envVal)) envVal = _.parseInt(envVal.trim())
        else if (/^\s*(true|on)\s*$/i.test(envVal)) envVal = true
        else if (/^\s*(false|off)\s*$/i.test(envVal)) envVal = false
        collection[key] = envVal
      }
    } else if (value && _.isPlainObject(value)) {
      importEnvVars(value, envKey)
    }
  })
}

export default (prefix, dir = cwd()) => {
  var localConfig = ''

  try {
    var defaultConfig = require(join(dir, 'config.default.json'))
  } catch (e) {
    throw new Error(`Default config corrupted`)
  }

  try {
    localConfig = require(join(dir, 'config.local.json'))
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e
  }

  let config = {}

  importEnvVars(_.merge(config, defaultConfig, localConfig), prefix)

  return config
}
