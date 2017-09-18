import debug from 'debug'

export default class Debug {
  constructor (id) {
    this._error = debug(`${ id }:error`)
    this._log = debug(`${ id }:log`)

    this._log.log = console.log.bind(console)
  }

  log () {
    this._log(...arguments)
  }

  logCb (...args) {
    return () => {
      this._log(...args)
    }
  }

  error () {
    this._error(...arguments)
  }

  errorCb (...args) {
    return () => {
      this._error(...args)
    }
  }
}