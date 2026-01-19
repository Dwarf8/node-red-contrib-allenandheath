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

        /* ================= CALLBACKS ================= */

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

        /* ================= CONNECTION ================= */

        node.connect = function () {
            if (!node.consoles[node.console]) {
                node.error("Invalid console type");
                return;
            }

            node.log(`Connecting to ${node.console} @ ${node.ipAddress}:${node.port}`);

            node.server = new net.Socket();

            node.server.connect(node.port, node.ipAddress, function () {
                const ok = node.consoles[node.console]
                    .initialConnection(node.server, node.midiChannel);

                node.connectionChanged(ok);
            });

            node.server.on("data", function (data) {
                const value = node.consoles[node.console]
                    .recieve(data, node.midiChannel, node.server);

                if (value && value !== true) {
                    node.sendMessage("any", value);
                }
            });

            node.server.on("error", function () {
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
        };

        /* ================= STATE ================= */

        node.connectionChanged = function (state) {
            if (node.connected === state) return;

            node.connected = state;

            if (state) {
                node.log("Connected");

                node.pingInterval = setInterval(() => {
                    node.consoles[node.console]
                        .sendPing(node.server, node.midiChannel, ok => {
                            if (!ok) node.connectionChanged(false);
                        });
                }, 10000);
            } else {
                node.log("Disconnected");
                node.disconnect();

                node.reconnectionTimeout = setTimeout(() => {
                    node.connect();
                }, 15000);
            }
        };

        /* ================= COMMAND ================= */

        node.sendCommand = function (msg, sender) {
            if (!node.connected) return;

            const value = node.consoles[node.console]
                .generatePacket(msg, node.server, node.midiChannel);

            if (value && value !== true) {
                node.server.write(value);
            }
        };

        /* ================= RESTART (LO QUE QUERÍAS) ================= */

        node.restart = function () {
            node.log("Restart requested");

            node.disconnect();

            try {
                node.consoles[node.console].reset();
            } catch (e) {}

            setTimeout(() => {
                node.connect();
            }, 500);
        };

        /* ================= CLOSE ================= */

        node.on("close", function () {
            node.disconnect();
        });

        /* ================= START ================= */

        node.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
};
