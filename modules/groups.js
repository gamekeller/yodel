import Promise from 'bluebird'
import Queue from 'bull'
import Debug from '../lib/util'
import YodelModule from '../lib/module'

let debug = new Debug('yodel:groups')

export default class Groups extends YodelModule {
  constructor (teamspeak, redis) {
    super(teamspeak, redis)

    this.setupQueue()
  }

  setupQueue () {
    this.queue = Queue('yodel:groups')

    this.queue.process(::this.processJob)
  }

  processJob (job) {
    let data = job.data
    let results = []

    debug.log('processing job', data.id, 'add:', data.add, 'remove:', data.remove)

    if (data.remove) {
      results.push(
        this.teamspeak.removeFromServerGroupByCluid(data.id, data.remove).catch((err) => {
          console.error(err)
          throw err
        })
      )
    }

    if (data.add) {
      results.push(
        this.teamspeak.addToServerGroupByCluid(data.id, data.add).catch((err) => {
          console.error(err)
          throw err
        })
      )
    }

    return Promise.all(results)
  }
}