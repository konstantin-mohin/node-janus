"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var es6_promise_1 = require("es6-promise");
var EventEmitter = require("eventemitter3");
exports.EventEmitter = EventEmitter;
var _ = require("lodash");
var objectAssign = require("object-assign");
var getTransactionId = function () { return (Math.random() * 10000000).toFixed().toString(); };
var janusFetch = function (endpoint, args) { return fetch(endpoint, objectAssign({
    headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
    },
}, args)).then(function (r) {
    if (r.ok)
        return r.json();
    else
        throw new Error(r.statusText);
}).then(function (r) {
    if (r.janus == "error")
        throw new Error(r.error.reason);
    else
        return r;
}); };
var Session = (function (_super) {
    __extends(Session, _super);
    function Session(endpoint, start, sessionId) {
        var _this = this;
        if (start === void 0) { start = true; }
        _super.call(this);
        this.endpoint = endpoint;
        this.handles = {};
        this.destroyed = false;
        this.destroying = false;
        this.polling = false;
        this.connected = false;
        if (!endpoint || endpoint.length == 0)
            throw new Error("Endpoint not specified");
        if (typeof (endpoint) != "string")
            throw new Error("Endpoint not a string");
        if (sessionId) {
            this._id = sessionId;
            if (start)
                this.poll();
        }
        else {
            janusFetch(endpoint, {
                method: "POST",
                body: JSON.stringify({
                    janus: "create",
                    transaction: Session.getTransactionId()
                })
            }).then(function (r) { return r.data.id; })
                .then(function (id) {
                _this._id = id;
                _this.connected = true;
                _this.emit("connected");
                if (start)
                    _this.poll();
            }).catch(function (err) { return _this.emit("error", err); });
        }
    }
    Object.defineProperty(Session.prototype, "id", {
        get: function () {
            return this._id;
        },
        enumerable: true,
        configurable: true
    });
    Session.prototype.fullEndpoint = function () {
        return this.endpoint + "/" + this.id;
    };
    Session.prototype.poll = function () {
        var _this = this;
        if (this.destroying || this.destroyed)
            throw new Error("Session is destroying or destroyed, please create another");
        if (this.polling)
            return;
        this.polling = true;
        janusFetch(this.fullEndpoint())
            .then(function (r) {
            if (!_this.destroying && !_this.destroyed) {
                if (!_this.connected) {
                    _this.connected = true;
                    _this.emit("connected");
                }
                var handle = null;
                if (r.sender && _this.handles[r.sender])
                    handle = _this.handles[r.sender];
                if (r.janus == "event" && handle) {
                    var payload = {};
                    if (r.plugindata && r.plugindata.data)
                        payload.data = r.plugindata.data;
                    if (r.jsep)
                        payload.jsep = r.jsep;
                    handle.emit("event", payload);
                }
                else if (r.janus == "webrtcup") {
                    _this.emit("webrtcup", r);
                    if (handle)
                        handle.emit("webrtcup", r);
                }
                else if (r.janus == "media") {
                    _this.emit("media", r);
                    if (handle)
                        handle.emit("media", r);
                }
                else if (r.janus == "hangup") {
                    _this.emit("hangup", r);
                    if (handle)
                        handle.emit("hangup", r);
                }
                if (!_this.destroyed && !_this.destroying) {
                    _this.polling = false;
                    _this.poll();
                }
            }
        }).catch(function (err) {
            _this.emit("error", err);
            _this.polling = false;
        });
    };
    Session.prototype.attach = function (pluginId) {
        var _this = this;
        if (typeof (pluginId) == "string") {
            if (!pluginId.length)
                throw new Error("No plugin ID specified");
            if (this.destroyed || this.destroying)
                throw new Error("Can't attach new plugins to sessions that are destroyed or destroying");
            return janusFetch(this.fullEndpoint(), {
                method: "POST",
                body: JSON.stringify({
                    janus: "attach",
                    plugin: pluginId,
                    transaction: Session.getTransactionId()
                })
            }).then(function (r) {
                var id = r.data.id;
                var h = new Handle(_this, id);
                _this.handles[id] = h;
                return h;
            });
        }
        else if (typeof (pluginId) == "number") {
            var handle = new Handle(this, pluginId);
            this.handles[pluginId] = handle;
            return es6_promise_1.Promise.resolve(handle);
        }
        throw new Error("Bad plugin ID");
    };
    Session.prototype.destroy = function () {
        var _this = this;
        if (!this.destroying && !this.destroyed) {
            this.destroying = true;
            this.emit("destroying");
            var promise = es6_promise_1.Promise.all(_.values(this.handles).map(function (h) { return h.destroy(); }))
                .then(function () { return janusFetch(_this.fullEndpoint(), {
                method: "POST",
                body: JSON.stringify({
                    janus: "destroy",
                    transaction: Session.getTransactionId()
                })
            }); }).then(function (r) {
                _this.polling = false;
                _this.destroying = false;
                _this.destroyed = true;
                _this.handles = {};
                _this._id = null;
                _this.emit("destroyed");
            }).catch(function (err) {
                _this.destroying = false;
                _this.destroyed = true;
                _this.emit("error", err);
            });
            return promise;
        }
    };
    Session.getTransactionId = getTransactionId;
    return Session;
}(EventEmitter));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Session;
var Handle = (function (_super) {
    __extends(Handle, _super);
    function Handle(session, _id) {
        _super.call(this);
        this.session = session;
        this._id = _id;
    }
    Object.defineProperty(Handle.prototype, "id", {
        get: function () {
            return this._id;
        },
        enumerable: true,
        configurable: true
    });
    Handle.prototype.fullEndpoint = function () {
        return this.session.fullEndpoint() + "/" + this.id;
    };
    Handle.prototype.message = function (body, jsep) {
        var payload = { janus: "message", transaction: Session.getTransactionId() };
        if (body)
            payload.body = body;
        else
            payload.body = {};
        if (jsep)
            payload.jsep = jsep;
        return janusFetch(this.fullEndpoint(), {
            method: "POST",
            body: JSON.stringify(payload)
        });
    };
    Handle.prototype.trickle = function (candidates) {
        var body = { janus: "trickle", transaction: Session.getTransactionId() };
        if (!candidates)
            body.candidate = { completed: true };
        else if (candidates.constructor == Array)
            body.candidates = candidates;
        else if (candidates instanceof Object)
            body.candidate = candidates;
        return janusFetch(this.fullEndpoint(), {
            method: "POST",
            body: JSON.stringify(body)
        });
    };
    Handle.prototype.hangup = function () {
        return janusFetch(this.fullEndpoint(), {
            method: "POST",
            body: JSON.stringify({
                janus: "hangup",
                transaction: Session.getTransactionId()
            })
        });
    };
    Handle.prototype.destroy = function () {
        var _this = this;
        this.emit("destroying");
        return janusFetch(this.fullEndpoint(), {
            method: "POST",
            body: JSON.stringify({
                janus: "detach",
                transaction: Session.getTransactionId()
            })
        }).then(function (r) { return _this.emit("destroyed"); })
            .catch(function (err) { return _this.emit("error", err); });
    };
    return Handle;
}(EventEmitter));
exports.Handle = Handle;
