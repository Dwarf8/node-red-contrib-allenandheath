const net = require("net");

module.exports = function (RED) {
    function AHNetwork(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ipAddress = config.ipAddress;
        node.port = config.port;
        node.console = config.console;
        node.midiChannel = (config.midiChannel - 1).toString(16);

        node.server = null;
        node.connected = false;
        node.reconnectionTimeout = null;
        node.pingInterval = null;

        node.errorCallbacks = [];
        node.successCallbacks = [];
        node.messageCallbacks = [];

        node.consoles = require("../functions/consoles.js").object();

        /* ===== CALLBACKS ===== */
        node.addErrorCallback = fn => node.errorCallbacks.push(fn);
        node.addSuccessCallback = fn => node.successCallbacks.push(fn);
        node.addMessageCallback = fn => node.messageCallbacks.push(fn);

        function sendTo(list, a, b) {
            list.forEach(fn => {
                try { fn(a, b); } catch (e) {}
            });
        }

        node.sendError = (a, b) => sendTo(node.errorCallbacks, a, b);
        node.sendSuccess = (a, b) => sendTo(node.successCallbacks, a, b);
        node.sendMessage = (a, b) => sendTo(node.messageCallbacks, a, b);

        /* ===== CONNECTION ===== */
        node.connect = function () {
            node.log(`=== DEBUG: connect() start ===`);
            node.log(`Console seleccionado: "${node.console}"`);
            node.log(`Keys disponibles en object.consoles: ${Object.keys(node.consoles).join(", ")}`);

            const consoleObj = node.consoles[node.console];

            if (!consoleObj) {
                node.error(`Console "${node.console}" no encontrada en object.consoles`);
                return;
            }

            if (typeof consoleObj.initialConnection !== "function") {
                node.error(`initialConnection NO es una función para la consola "${node.console}"`);
                return;
            }

            node.log(`Connecting to ${node.console} @ ${node.ipAddress}:${node.port}`);

            node.server = new net.Socket();

            node.server.connect(node.port, node.ipAddress, function () {
                try {
                    node.log(`=== DEBUG: connect callback ===`);
                    node.log(`Intentando initialConnection para consola "${node.console}"`);

                    const result = consoleObj.initialConnection(node.server, node.midiChannel);

                    node.log(`Resultado de initialConnection: ${result}`);
                    node.connectionChanged(result);

                } catch (err) {
                    node.error(`Error en connect callback: ${err.message}`, err);
                }
            });

            node.server.on("data", function (data) {
                try {
                    const value = consoleObj.recieve(data, node.midiChannel, node.server);
                    if (value && value !== true) node.sendMessage("any", value);
                } catch (err) {
                    node.error(`Error en server.on("data"): ${err.message}`, err);
                }
            });

            node.server.on("error", function (err) {
                node.error(`Socket error: ${err.message}`, err);
                node.connectionChanged(false);
            });
        };

        node.disconnect = function () {
            if (node.server) {
                try { node.server.destroy(); } catch (e) {}
            }
            node.server = null;
            node.connected = false;
            clearInterval(node.pingInterval);
            clearTimeout(node.reconnectionTimeout);
            node.log("Disconnected / resources cleared");
        };

        /* ===== STATE ===== */
        node.connectionChanged = function (state) {
            if (node.connected === state) return;

            node.connected = state;

            if (state) {
                node.log("Connected");
                node.pingInterval = setInterval(() => {
                    try {
                        node.consoles[node.console]
                            .sendPing(node.server, node.midiChannel, ok => {
                                if (!ok) node.connectionChanged(false);
                            });
                    } catch (err) {
                        node.error(`Error en sendPing: ${err.message}`, err);
                    }
                }, 10000);
            } else {
                node.log("Disconnected");
                node.disconnect();
                node.reconnectionTimeout = setTimeout(() => {
                    node.connect();
                }, 15000);
            }
        };

        /* ===== COMMAND ===== */
        node.sendCommand = function (msg, sender) {
            if (!node.connected) {
                node.log("sendCommand ignorado: nodo no conectado");
                return;
            }

            try {
                const value = node.consoles[node.console]
                    .generatePacket(msg, node.server, node.midiChannel);

                if (value && value !== true) node.server.write(value);
                node.log(`sendCommand ejecutado: ${JSON.stringify(msg)}`);
            } catch (err) {
                node.error(`Error en sendCommand: ${err.message}`, err);
            }
        };

        /* ===== RESTART ===== */
        node.restart = function () {
            node.log("Restart requested");

            node.disconnect();

            try { node.consoles[node.console].reset(); } catch (e) {
                node.error(`Error al resetear consola: ${e.message}`, e);
            }

            setTimeout(() => {
                node.log("Reconnect tras restart...");
                node.connect();
            }, 500);
        };

        /* ===== CLOSE ===== */
        node.on("close", function () {
            node.log("Node closing, cleaning resources...");
            node.disconnect();
        });

        /* ===== START ===== */
        node.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
};
