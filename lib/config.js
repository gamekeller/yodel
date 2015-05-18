import cwd from 'cwd'
import { merge } from 'lodash'

let defaultConfig = require(cwd('config.default.json'))
let localConfig = require(cwd('config.local.json'))

export default merge({}, defaultConfig, localConfig)