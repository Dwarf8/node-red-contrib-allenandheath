module.exports = function(RED) {
    function AHNetworkControl(config) {
        RED.nodes.createNode(this, config);

        const network = RED.nodes.getNode(config.network);

        this.on("input", msg => {
            if (!network) return;

            if (msg.topic === "restart") {
                network.restart();
            }
        });
    }

    RED.nodes.registerType("allenandheath-AHNetwork-control", AHNetworkControl);
};
