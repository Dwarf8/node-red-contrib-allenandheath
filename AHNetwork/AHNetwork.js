const net = require("net");

module.exports = function (RED) {
    function AHNetwork(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        node.midiChannel = (config.midiChannel - 1).toString(16);
        node.ipAddress = config.ipAddress;
        node.port = config.port;
        node.console = config.console;

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

        /* ================= CONNECTION ================= */

        node.connect = function () {
            if (!node.consoles[node.console]) {
                node.error("Console type not defined");
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

        /* ================= STATE ================= */

        node.connectionChanged = function (state) {
            if (node.connected === state) return;

            node.connected = state;

            if (state) {
                node.log("Connected");
                node.sendMessage("any", { topic: "connectionState", payload: "connected" });

                node.pingInterval = setInterval(() => {
                    node.consoles[node.console]
                        .sendPing(node.server, node.midiChannel, ok => {
                            if (!ok) node.connectionChanged(false);
                        });
                }, 10000);
            } else {
                node.log("Disconnected");
                if (node.server) node.server.destroy();
                clearInterval(node.pingInterval);

                setTimeout(() => node.connect(), 5000);
            }
        };

        /* ================= SEND ================= */

        node.sendCommand = function (msg, sender) {
            if (!node.connected) return;

            const value = node.consoles[node.console]
                .generatePacket(msg, node.server, node.midiChannel);

            if (value && value !== true) {
                node.server.write(value);
            }
        };

        /* ================= INPUT ================= */

        node.on("input", function (msg) {
            if (msg.topic === "restart") {
                node.log("Restart requested");

                clearInterval(node.pingInterval);
                clearTimeout(node.reconnectionTimeout);

                if (node.server) node.server.destroy();
                node.connected = false;

                if (node.consoles[node.console]?.reset) {
                    node.consoles[node.console].reset();
                }

                setTimeout(() => node.connect(), 500);
                return;
            }

            node.sendCommand(msg, "input");
        });

        node.on("close", function () {
            if (node.server) node.server.destroy();
            clearInterval(node.pingInterval);
            clearTimeout(node.reconnectionTimeout);
        });

        node.connect();
    }

    RED.nodes.registerType("allenandheath-AHNetwork", AHNetwork);
};
