const net = require('net');

module.exports = function(RED) {
    function AHNetwork(config) {
        RED.nodes.createNode(this, config);

        const object = this;

        this.midiChannel = (config.midiChannel - 1).toString(16);
        this.ipAddress = config.ipAddress;
        this.port = config.port;
        this.console = config.console;

        this.server = undefined;
        this.connected = false;
        this.reconnectionTimeout = undefined;
        this.pingInterval = undefined;

        this.errorCallbacks = [];
        this.successCallbacks = [];
        this.messageCallbacks = [];

        this.consoles = require("../functions/consoles.js").object();

        /* ================= CALLBACKS ================= */

        this.addErrorCallback = fn => this.errorCallbacks.push(fn);
        this.addSuccessCallback = fn => this.successCallbacks.push(fn);
        this.addMessageCallback = fn => this.messageCallbacks.push(fn);

        /* ================= CONNECTION ================= */

        this.connect = function() {
            object.log(`Connecting to ${object.console} @ ${object.ipAddress}:${object.port}`);
            object.sendSuccess("any", "Connecting");

            object.server = new net.Socket();

            object.server.connect(object.port, object.ipAddress, () => {
                object.connectionChanged(
                    object.consoles[object.console]
                        .initialConnection(object.server, object.midiChannel)
                );
            });

            object.server.on("data", message => {
                const callback = value => {
                    if (typeof value === "string") {
                        object.error(value);
                        object.sendError("any", value);
                    } else if (value !== false && value !== true && value !== undefined) {
                        object.sendMessage("any", value);
                    }
                };

                const value = object.consoles[object.console]
                    .recieve(message, object.midiChannel, object.server, callback);

                callback(value);
            });

            object.server.on("error", () => {
                object.connectionChanged(false);
            });
        };

        this.connectionChanged = function(state, reconnect = true) {
            if (object.connected !== state) {
                object.connected = state;

                clearInterval(object.pingInterval);

                if (state) {
                    object.sendMessage("any", { topic: "connectionState", payload: "connected" });

                    object.pingInterval = setInterval(() => {
                        object.consoles[object.console]
                            .sendPing(object.server, object.midiChannel, ok => {
                                if (!ok) object.connectionChanged(false);
                            });
                    }, 10000);
                } else {
                    if (object.server) object.server.destroy();
                    object.sendMessage("any", { topic: "connectionState", payload: "disconnected" });
                }
            }

            if (!state && reconnect && !object.reconnectionTimeout) {
                object.reconnectionTimeout = setTimeout(() => {
                    object.reconnectionTimeout = undefined;
                    object.connect();
                }, 15000);
            }
        };

        /* ================= PUBLIC API ================= */

        this.restart = function() {
            object.log("Restart solicitado");

            clearInterval(object.pingInterval);
            clearTimeout(object.reconnectionTimeout);

            if (object.server) {
                try { object.server.destroy(); } catch(e) {}
            }

            object.connected = false;

            try {
                object.consoles[object.console].reset();
            } catch(e) {}

            setTimeout(() => object.connect(), 500);
        };

        /* ================= SENDERS ================= */

        this.sendError = (s,m) => this.errorCallbacks.forEach(fn => fn(s,m));
        this.sendSuccess = (s,m) => this.successCallbacks.forEach(fn => fn(s,m));
        this.sendMessage = (s,m) => this.messageCallbacks.forEach(fn => fn(s,m));

        this.on("close", () => {
            clearInterval(object.pingInterval);
            clearTimeout(object.reconnectionTimeout);
            if (object.server) object.server.destroy();
        });

        this.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
};
