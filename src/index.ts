import {Promise} from "es6-promise"
import * as EventEmitter from "eventemitter3"
import * as _ from "lodash"
import objectAssign = require("object-assign")

export {EventEmitter}

const getTransactionId = (): string => (Math.random()*10000000).toFixed().toString()

const janusFetch = (endpoint: string, args?: Object): Promise<any> => fetch(
  endpoint, objectAssign({
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  }, args)).then((r) => {
    if(r.ok)
      return r.json()
    else
      throw new Error(r.statusText)
  }).then((r) => {
    if(r.janus == "error")
      throw new Error(r.error.reason)
    else
      return r
  })

interface EventPayload {
  data?: Object
  jsep?: Object
}

interface Handles {
  [id: number]: Handle
}

export default class Session extends EventEmitter {

  static getTransactionId: () => string = getTransactionId

  private handles: Handles = {}

  private destroyed = false
  private destroying = false

  private _id: number

  get id(): number {
    return this._id
  }

  private polling = false

  private connected = false

  constructor(private endpoint: string, start: boolean = true, sessionId?: number) {
    super()
    if(!endpoint || endpoint.length == 0)
      throw new Error("Endpoint not specified")
    if(typeof(endpoint) != "string")
      throw new Error("Endpoint not a string")
    if(sessionId) {
      this._id = sessionId
      if(start)
        this.poll()
    } else {
      janusFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({
          janus: "create",
          transaction: Session.getTransactionId()
        })
      }).then((r) => r.data.id)
      .then((id) => {
        this._id = id
        this.connected = true
        this.emit("connected")
        if(start)
          this.poll()
      }).catch((err) => this.emit("error", err))
    }
  }

  fullEndpoint() {
    return `${this.endpoint}/${this.id}`
  }

  poll() {
    if(this.destroying || this.destroyed)
      throw new Error("Session is destroying or destroyed, please create another")
    if(this.polling)
      return
    this.polling = true
    janusFetch(this.fullEndpoint())
    .then((r) => {
      if(!this.destroying && !this.destroyed) {
        if(!this.connected) {
          this.connected = true
          this.emit("connected")
        }
        let handle = null
        if(r.sender && this.handles[r.sender])
          handle = this.handles[r.sender]
        if(r.janus == "event" && handle) {
          const payload: EventPayload = {}
          if(r.plugindata && r.plugindata.data)
            payload.data = r.plugindata.data
          if(r.jsep)
            payload.jsep = r.jsep
          handle.emit("event", payload)
        } else if(r.janus == "webrtcup") {
          this.emit("webrtcup", r)
          if(handle)
            handle.emit("webrtcup", r)
        } else if(r.janus == "media") {
          this.emit("media", r)
          if(handle)
            handle.emit("media", r)
        } else if(r.janus == "hangup")  {
          this.emit("hangup", r)
          if(handle)
            handle.emit("hangup", r)
        }
        if(!this.destroyed && !this.destroying) {
          this.polling = false
          this.poll()
        }
      }
    }).catch((err) => {
      this.emit("error", err)
      this.polling = false
    })
  }

  attach(pluginId: string | number): Promise<any> {
    if(typeof(pluginId) == "string") {
      if(!(pluginId as string).length)
        throw new Error("No plugin ID specified")
      if(this.destroyed || this.destroying)
        throw new Error("Can't attach new plugins to sessions that are destroyed or destroying")
      return janusFetch(this.fullEndpoint(), {
        method: "POST",
        body: JSON.stringify({
          janus: "attach",
          plugin: pluginId,
          transaction: Session.getTransactionId()
        })
      }).then((r) => {
        const id = r.data.id
        const h = new Handle(this, id)
        this.handles[id] = h
        return h
      })
    } else if(typeof(pluginId) == "number") {
      const handle = new Handle(this, pluginId as number)
      this.handles[pluginId] = handle
      return Promise.resolve(handle)
    }
    throw new Error("Bad plugin ID")
  }

  destroy() {
    if(!this.destroying && !this.destroyed) {
      this.destroying = true
      this.emit("destroying")
      const promise = Promise.all(_.values(this.handles).map((h: Handle) => h.destroy()))
      .then(() => janusFetch(this.fullEndpoint(), {
        method: "POST",
        body: JSON.stringify({
          janus: "destroy",
          transaction: Session.getTransactionId()
        })
      })).then((r) => {
        this.polling = false
        this.destroying = false
        this.destroyed = true
        this.handles = {}
        this._id = null
        this.emit("destroyed")
      }).catch((err) => {
        this.destroying = false
        this.destroyed = true
        this.emit("error", err)
      })
      return promise
    }
  }

}

interface CandidatePayload {
  janus: string
  transaction: string
  candidate?: Object
  candidates?: Array<Object>
}

interface MessagePayload {
  janus: string
  transaction: string
  body?: any
  jsep?: Object
}

export class Handle extends EventEmitter {

  get id(): number {
    return this._id
  }

  constructor(private session: Session, private _id: number) {
    super()
  }

  private fullEndpoint() {
    return `${this.session.fullEndpoint()}/${this.id}`
  }

  message(body: Object, jsep: Object) {
    const payload: MessagePayload = {janus: "message", transaction: Session.getTransactionId()}
    if(body)
      payload.body = body
    else
      payload.body = {}
    if(jsep)
      payload.jsep = jsep
    return janusFetch(this.fullEndpoint(), {
      method: "POST",
      body: JSON.stringify(payload)
    })
  }

  trickle(candidates?: Array<Object> | Object) {
    const body: CandidatePayload = {janus: "trickle", transaction: Session.getTransactionId()}
    if(!candidates)
      body.candidate = {completed: true}
    else if(candidates.constructor == Array)
      body.candidates = candidates as Array<Object>
    else if(candidates instanceof Object)
      body.candidate = candidates
    return janusFetch(this.fullEndpoint(), {
      method: "POST",
      body: JSON.stringify(body)
    })
  }

  hangup() {
    return janusFetch(this.fullEndpoint(), {
      method: "POST",
      body: JSON.stringify({
        janus: "hangup",
        transaction: Session.getTransactionId()
      })
    })
  }

  destroy() {
    this.emit("destroying")
    return janusFetch(this.fullEndpoint(), {
      method: "POST",
      body: JSON.stringify({
        janus: "detach",
        transaction: Session.getTransactionId()
      })
    }).then((r) => this.emit("destroyed"))
    .catch((err) => this.emit("error", err))
  }

}
