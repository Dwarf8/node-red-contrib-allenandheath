const net = require('net');

module.exports = function(RED) {
    function AHNetwork(config) {
        RED.nodes.createNode(this, config);
        const object = this;

        // Configuración
        this.midiChannel = (config.midiChannel - 1).toString(16);
        this.ipAddress = config.ipAddress;
        this.port = config.port;
        this.console = config.console; // ej. "ahm32"
        this.server = undefined;
        this.connected = false;
        this.pingInterval = undefined;
        this.reconnectionTimeout = undefined;

        // Callbacks
        this.errorCallbacks = [];
        this.successCallbacks = [];
        this.messageCallbacks = [];

        // Consoles
        this.consoles = require("../functions/consoles.js").object();

        // === Callbacks helpers ===
        this.addErrorCallback = fn => this.errorCallbacks.push(fn);
        this.addSuccessCallback = fn => this.successCallbacks.push(fn);
        this.addMessageCallback = fn => this.messageCallbacks.push(fn);

        this.sendError = (sender, msg) => {
            object.log("[sendError] " + msg);
            object.errorCallbacks.forEach(fn => fn(sender, msg));
        }

        this.sendSuccess = (sender, msg) => {
            object.log("[sendSuccess] " + msg);
            object.successCallbacks.forEach(fn => fn(sender, msg));
        }

        this.sendMessage = (sender, msg) => {
            object.log("[sendMessage] " + JSON.stringify(msg));
            object.messageCallbacks.forEach(fn => fn(sender, msg));
        }

        // === Helpers para consola ===
        this.getConsoleObject = function() {
            // Determina tipo y objeto interno
            let typeKey = Object.keys(object.consoles).find(key => object.console.toLowerCase().startsWith(key));
            if(!typeKey) return null;
            let consoleObj = object.consoles[typeKey];

            // Si es objeto, revisa si tiene sub-objeto
            if(consoleObj.object) consoleObj = consoleObj.object();
            if(consoleObj[object.console]) consoleObj = consoleObj[object.console];
            return consoleObj;
        }

        // === Conexión ===
        this.connect = function() {
            object.log(`[connect] Attempting connection to ${object.console} @ ${object.ipAddress}:${object.port}`);
            object.sendSuccess("any", "Connecting");

            const consoleObj = object.getConsoleObject();
            if(!consoleObj || typeof consoleObj.initialConnection !== "function") {
                object.error(`[connect] Console not initialized correctly: ${object.console}`);
                object.sendError("any", "Console not initialized correctly");
                object.connectionChanged(false, false);
                return;
            }

            object.server = new net.Socket();

            object.server.connect(object.port, object.ipAddress, function() {
                object.log("[connect] Socket connected, calling initialConnection...");
                try {
                    object.connectionChanged(consoleObj.initialConnection(object.server, object.midiChannel));
                } catch(err) {
                    object.error("[connect] Error in initialConnection: " + err.message);
                    object.connectionChanged(false, false);
                }
            });

            object.server.on("data", function(message) {
                object.log("[data] Received message: " + message.toString('hex'));
                try {
                    const callback = function(value) {
                        if(typeof value === "string") {
                            object.error("[data callback] Function error: " + value);
                            object.sendError("any", "Function error check debug");
                        } else if(value !== false && value !== true && value !== undefined) {
                            object.sendSuccess("any", "Got message!");
                            object.sendMessage("any", value);
                        }
                    }
                    const value = consoleObj.recieve(message, object.midiChannel, object.server, callback);
                    callback(value);
                } catch(err) {
                    object.error("[data] Error processing message: " + err.message);
                }
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

        // === Cambio de estado de conexión ===
        this.connectionChanged = function(state, reconnect=true) {
            if(object.connected !== state) {
                if(state) {
                    object.connected = true;
                    object.log("[connectionChanged] Connected");
                    object.sendSuccess("any", "Connected");
                    object.sendMessage("any", {topic:"connectionState", payload:"connected"});

                    clearInterval(object.pingInterval);
                    const consoleObj = object.getConsoleObject();
                    if(consoleObj && typeof consoleObj.sendPing === "function") {
                        object.pingInterval = setInterval(() => {
                            consoleObj.sendPing(object.server, object.midiChannel, success => {
                                if(success) object.sendSuccess("any","Ping success");
                                else {
                                    object.sendError("any","Ping failed");
                                    object.connectionChanged(false);
                                }
                            });
                        }, 10000);
                    }
                } else {
                    object.connected = false;
                    if(object.server) object.server.destroy();
                    clearInterval(object.pingInterval);
                    object.log("[connectionChanged] Lost connection");
                    object.sendError("any","Disconnected");
                    object.sendMessage("any",{topic:"connectionState", payload:"disconnected"});
                }
            }

            if(!state && reconnect) {
                if(object.reconnectionTimeout === undefined) {
                    object.reconnectionTimeout = setTimeout(() => {
                        clearTimeout(object.reconnectionTimeout);
                        object.reconnectionTimeout = undefined;
                        object.log("[connectionChanged] Attempting reconnection...");
                        object.sendError("any","Attempting reconnection");
                        object.sendMessage("any",{topic:"connectionState", payload:"reconnecting"});
                        object.connect();
                    }, 15000);
                }
            }
        }

        // === Enviar comando ===
        this.sendCommand = function(msg, sender, network) {
            const consoleObj = object.getConsoleObject();
            if(!consoleObj || typeof consoleObj.generatePacket !== "function") {
                object.sendError(sender,"Console not ready");
                return;
            }

            const value = consoleObj.generatePacket(msg, network.server, network.midiChannel, sentMsg => {
                object.sendMessage(sender, sentMsg);
            });

            if(typeof value === "string") {
                object.error("Function Error: " + value);
                object.sendError(sender, "Function Error: " + value);
            } else if(value !== false) {
                if(value !== true) object.server.write(value);
                object.sendSuccess(sender, "Sent!");
            } else {
                object.error("No Function Found");
                object.sendError(sender, "Function Error: No Function Found");
            }
        }

        // === Restart ===
        this.restart = function() {
            object.log("[restart] Restarting AHNetwork...");
            if(object.server) {
                object.log("[restart] Destroying server");
                object.server.destroy();
                object.server = undefined;
            }

            clearInterval(object.pingInterval);
            object.pingInterval = undefined;

            clearTimeout(object.reconnectionTimeout);
            object.reconnectionTimeout = undefined;

            object.connected = false;

            const consoleObj = object.getConsoleObject();
            if(consoleObj && typeof consoleObj.reset === "function") {
                object.log("[restart] Resetting console state");
                consoleObj.reset();
            }

            object.log("[restart] Reconnecting...");
            object.connect();
        }

        // === Node close ===
        this.on("close", function() {
            object.log("[close] Node closing...");
            if(object.server) object.server.destroy();
            object.server = undefined;

            const consoleObj = object.getConsoleObject();
            if(consoleObj && typeof consoleObj.reset === "function") consoleObj.reset();

            object.connected = false;
            clearInterval(object.pingInterval);
        });

        // Inicializar
        this.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
}
