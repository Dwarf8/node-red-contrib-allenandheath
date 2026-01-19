const net = require('net');

module.exports = function(RED) {
    function AHNetwork(config) {
        RED.nodes.createNode(this, config);

        this.midiChannel = (config.midiChannel - 1).toString(16);
        this.ipAddress = config.ipAddress;
        this.port = config.port;
        this.errorCallbacks = [];
        this.successCallbacks = [];
        this.messageCallbacks = [];
        this.console = config.console;
        this.server = undefined;
        this.connected = false;
        this.reconnectionTimeout = undefined;
        this.pingInterval = undefined;
        this.consoles = require("../functions/consoles.js").object();

        var object = this;

        /* ===================== CALLBACKS ===================== */

        this.addErrorCallback = function(fn) {
            this.errorCallbacks.push(fn);
        };

        this.addSuccessCallback = function(fn) {
            this.successCallbacks.push(fn);
        };

        this.addMessageCallback = function(fn) {
            this.messageCallbacks.push(fn);
        };

        /* ===================== CONNECTION ===================== */

        this.connect = function() {
            this.log(
                "Attempting connection to Allen & Heath Console: " +
                config.console + " @ IP: " +
                config.ipAddress + ":" + config.port
            );

            this.sendSuccess("any", "Connecting");

            this.server = new net.Socket();

            this.server.connect(this.port, this.ipAddress, function() {
                object.connectionChanged(
                    object.consoles[object.console]
                        .initialConnection(object.server, object.midiChannel)
                );
            });

            this.server.on("data", function(message) {
                var callback = function(value) {
                    if (typeof value === "string") {
                        object.error("Function Error: " + value);
                        object.sendError("any", "Function error check debug");
                    }
                    else if (value !== false && value !== true && value !== undefined) {
                        object.sendSuccess("any", "Got message!");
                        object.sendMessage("any", value);
                    }
                };

                var value = object.consoles[object.console]
                    .recieve(message, object.midiChannel, object.server, callback);

                callback(value);
            });

            this.server.on("error", function(e) {
                switch (e.code) {
                    case "EADDRINUSE":
                        object.error(
                            "Critical Error: Socket In Use for Allen & Heath console: " +
                            config.console
                        );
                        object.sendError("any", "Failed connection");
                        object.connectionChanged(false, false);
                        break;

                    case "EHOSTUNREACH":
                        object.error(
                            "Failed to reach Allen & Heath console: " +
                            config.console
                        );
                        object.sendError("any", "Host unreachable");
                        object.connectionChanged(false);
                        break;

                    case "ECONNRESET":
                        break;

                    default:
                        object.log(
                            "Socket error, attempting reconnect: " + e.code
                        );
                        object.sendError("any", "Disconnected");
                        object.connectionChanged(false);
                        break;
                }
            });
        };

        /* ===================== STATE ===================== */

        this.connectionChanged = function(state, reconnect = true) {
            if (object.connected !== state) {
                if (state === true) {
                    object.connected = true;
                    object.log("Connected");
                    object.sendSuccess("any", "Connected");
                    object.sendMessage("any", {
                        topic: "connectionState",
                        payload: "connected"
                    });

                    clearInterval(object.pingInterval);
                    object.pingInterval = setInterval(function() {
                        object.consoles[object.console]
                            .sendPing(object.server, object.midiChannel, function(success) {
                                if (success === true) {
                                    object.sendSuccess("any", "Ping success");
                                } else {
                                    object.sendError("any", "Ping failed");
                                    object.connectionChanged(false);
                                }
                            });
                    }, 10000);
                }
                else {
                    object.connected = false;

                    if (object.server) {
                        try { object.server.destroy(); } catch (e) {}
                    }

                    clearInterval(object.pingInterval);

                    object.log("Lost connection!");
                    object.sendError("any", "Disconnected");
                    object.sendMessage("any", {
                        topic: "connectionState",
                        payload: "disconnected"
                    });
                }
            }

            if (state === false && reconnect === true) {
                if (object.reconnectionTimeout === undefined) {
                    object.reconnectionTimeout = setTimeout(function() {
                        clearTimeout(object.reconnectionTimeout);
                        object.reconnectionTimeout = undefined;

                        object.log("Attempting reconnection");
                        object.sendError("any", "Attempting reconnection");
                        object.sendMessage("any", {
                            topic: "connectionState",
                            payload: "reconnecting"
                        });

                        object.connect();
                    }, 15000);
                }
            }
        };

        /* ===================== SENDERS ===================== */

        this.sendError = function(sender, message) {
            for (let i = 0; i < this.errorCallbacks.length; i++) {
                this.errorCallbacks[i](sender, message);
            }
        };

        this.sendSuccess = function(sender, message) {
            for (let i = 0; i < this.successCallbacks.length; i++) {
                this.successCallbacks[i](sender, message);
            }
        };

        this.sendMessage = function(sender, message) {
            for (let i = 0; i < this.messageCallbacks.length; i++) {
                this.messageCallbacks[i](sender, message);
            }
        };

        /* ===================== COMMAND ===================== */

        this.sendCommand = function(msg, sender, network) {
            var value = object.consoles[object.console]
                .generatePacket(msg, network.server, network.midiChannel, function(msg) {
                    object.sendMessage(sender, msg);
                });

            if (typeof value === "string") {
                object.error("Function Error: " + value);
                object.sendError(sender, value);
            }
            else if (value !== false) {
                if (value !== true) {
                    object.server.write(value);
                }
                object.sendSuccess(sender, "Sent!");
            }
            else {
                object.error("No Function Found");
                object.sendError(sender, "No Function Found");
            }
        };

        /* ===================== INPUT (RESTART) ===================== */

        this.on("input", function(msg) {
            if (msg && msg.topic === "restart") {
                object.log("Restart solicitado por mensaje");

                if (object.reconnectionTimeout) {
                    clearTimeout(object.reconnectionTimeout);
                    object.reconnectionTimeout = undefined;
                }

                clearInterval(object.pingInterval);

                if (object.server) {
                    try { object.server.destroy(); } catch (e) {}
                }

                object.connected = false;

                try {
                    object.consoles[object.console].reset();
                } catch (e) {}

                setTimeout(function() {
                    object.connect();
                }, 500);
            }
        });

        /* ===================== CLOSE ===================== */

        this.on("close", function() {
            if (object.server) {
                try { object.server.destroy(); } catch (e) {}
            }

            object.server = undefined;
            object.connected = false;

            clearInterval(object.pingInterval);
            clearTimeout(object.reconnectionTimeout);

            try {
                object.consoles[object.console].reset();
            } catch (e) {}
        });

        /* ===================== START ===================== */

        this.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
};
