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

        // === Callbacks ===
        this.addErrorCallback = function(fn) { this.errorCallbacks.push(fn); }
        this.addSuccessCallback = function(fn) { this.successCallbacks.push(fn); }
        this.addMessageCallback = function(fn) { this.messageCallbacks.push(fn); }

        // === Send functions ===
        this.sendError = function(sender, message) {
            object.log("[sendError] " + message);
            for(let i = 0; i < this.errorCallbacks.length; i++) this.errorCallbacks[i](sender, message);
        }

        this.sendSuccess = function(sender, message) {
            object.log("[sendSuccess] " + message);
            for(let i = 0; i < this.successCallbacks.length; i++) this.successCallbacks[i](sender, message);
        }

        this.sendMessage = function(sender, message) {
            object.log("[sendMessage] " + JSON.stringify(message));
            for(let i = 0; i < this.messageCallbacks.length; i++) this.messageCallbacks[i](sender, message);
        }

        // === Connection handling ===
        this.connect = function() {
            object.log(`[connect] Attempting connection to console ${config.console} @ ${config.ipAddress}:${config.port}`);
            object.sendSuccess("any", "Connecting");

            object.server = new net.Socket();

            object.server.connect(object.port, object.ipAddress, function() {
                object.log("[connect] Socket connected, initializing console...");
                object.connectionChanged(object.consoles[object.console].initialConnection(object.server, object.midiChannel));
            });

            object.server.on("data", function(message) {
                object.log("[data] Message received: " + message.toString('hex'));
                var callback = function(value) {
                    if(typeof value === "string") {
                        object.error("[data callback] Function error: " + value);
                        object.sendError("any", "Function error check debug");
                    }
                    else if(value != false && value != true && value != undefined){
                        object.sendSuccess("any", "Got message!");
                        object.sendMessage("any", value);
                    }   
                }
                var value = object.consoles[object.console].recieve(message, object.midiChannel, object.server, callback);
                callback(value);
            });

            object.server.on("error", function(e) {
                object.log("[error] Socket error: " + e.code);
                switch(e.code) {
                    case "EADDRINUSE":
                        object.error("Critical Error: Socket In Use");
                        object.sendError("any", "Failed connection check debug!");
                        object.connectionChanged(false, false);
                        break;
                    case "EHOSTUNREACH":
                        object.error("Failed to reach console");
                        object.sendError("any", "Failed connection check debug!");
                        object.connectionChanged(false);
                        break;
                    case "ECONNRESET": break;
                    default:
                        object.log("Attempting reconnect due to socket error: " + e.code);
                        object.sendError("any", "Disconnected");
                        object.connectionChanged(false);
                        break;
                }
            });
        }

        this.connectionChanged = function(state, reconnect=true) {
            if(object.connected != state) {
                if(state == true) {
                    object.connected = true;
                    object.log("[connectionChanged] Connected");
                    object.sendSuccess("any", "Connected");
                    object.sendMessage("any", {topic: "connectionState", payload: "connected"});

                    clearInterval(object.pingInterval);
                    object.pingInterval = setInterval(function() {
                        object.consoles[object.console].sendPing(object.server, object.midiChannel, function(success) {
                            if(success) {
                                object.sendSuccess("any", "Ping success");
                            } else {
                                object.sendError("any", "Ping failed");
                                object.connectionChanged(false);
                            }
                        });
                    }, 10000);
                } else {
                    object.connected = false;
                    if(object.server) object.server.destroy();
                    clearInterval(object.pingInterval);
                    object.log("[connectionChanged] Lost connection!");
                    object.sendError("any", "Disconnected");
                    object.sendMessage("any", {topic: "connectionState", payload: "disconnected"});
                }
            }

            // Reconnect if needed
            if(state == false && reconnect) {
                if(object.reconnectionTimeout == undefined) {
                    object.reconnectionTimeout = setTimeout(function() {
                        clearTimeout(object.reconnectionTimeout);
                        object.reconnectionTimeout = undefined;
                        object.log("[connectionChanged] Attempting reconnection");
                        object.sendError("any", "Attempting reconnection");
                        object.sendMessage("any", {topic: "connectionState", payload: "reconnecting"});
                        object.connect();
                    }, 15000);
                }
                object.sendMessage("any", {topic: "connectionState", payload: "disconnected"});
            }
        }

        // === Command sending ===
        this.sendCommand = function(msg, sender, network) {
            var value = object.consoles[object.console].generatePacket(msg, network.server, network.midiChannel, function(msg) {
                object.sendMessage(sender, msg);
            });

            if(typeof value === "string") {
                object.error("Function Error: " + value);
                object.sendError(sender, "Function Error: " + value);
            } else if(value != false){
                if(value != true) object.server.write(value);
                object.sendSuccess(sender, "Sent!");
            } else {
                object.error("No Function Found");
                object.sendError(sender, "Function Error: No Function Found");
            }
        }

        // === Restart method ===
        this.restart = function() {
            object.log("[restart] Restarting AHNetwork...");
            if(object.server) {
                object.log("[restart] Destroying existing server connection");
                object.server.destroy();
                object.server = undefined;
            }

            clearInterval(object.pingInterval);
            object.pingInterval = undefined;

            clearTimeout(object.reconnectionTimeout);
            object.reconnectionTimeout = undefined;

            object.connected = false;

            if(object.consoles[object.console] && typeof object.consoles[object.console].reset === "function") {
                object.log("[restart] Resetting console state");
                object.consoles[object.console].reset();
            }

            object.log("[restart] Reconnecting...");
            object.connect();
        }

        // === Node events ===
        this.on("close", function() {
            object.log("[close] Node is closing");
            if(object.server) object.server.destroy();
            object.server = undefined;
            if(object.consoles[object.console] && typeof object.consoles[object.console].reset === "function") {
                object.consoles[object.console].reset();
            }
            object.connected = false;
            clearInterval(object.pingInterval);
        });

        // === Inicial connect ===
        this.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
}
