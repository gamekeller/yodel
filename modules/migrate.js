import _ from 'lodash'
//import Debug from '../lib/util'
import YodelModule from '../lib/module'

//let debug = new Debug('yodel:migrate')

export default class Migrate extends YodelModule {
  constructor (teamspeak, redis) {
    super(teamspeak, redis)

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('client.enter', ::this.onClientEnter)
  }

  handleCluid (cluid) {
    this.redis.hget('migrate', cluid).then((result) => {
      if (!result) return

      this.teamspeak.addToServerGroupByCluid(cluid, result.split(',')).then(() => {
        this.redis.hdel('migrate', cluid)
      })
    })
  }

  onConnect (onlineClients) {
    _.each(onlineClients, (client) => {
      this.handleCluid(client.client_unique_identifier)
    })
  }

  onClientEnter (client) {
    this.handleCluid(client.client_unique_identifier)
  }
}