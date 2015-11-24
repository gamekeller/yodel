export default class Module {
  constructor (teamspeak, redis, config) {
    this.teamspeak = teamspeak
    this.redis = redis
    this.cluidCache = this.teamspeak.cluidMap

    if (config) {
      this.config = config
    }
  }
}