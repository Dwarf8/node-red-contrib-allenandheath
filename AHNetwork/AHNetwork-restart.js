module.exports = function(RED) {
    function AHNetworkRestart(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const network = RED.nodes.getNode(config.network); // AHNetwork config node

        node.on("input", function(msg) {
            if (network && typeof network.restart === "function") {
                network.restart();
                node.status({fill:"green", shape:"dot", text:"Restarted"});
            } else {
                node.status({fill:"red", shape:"ring", text:"No network"});
            }
        });
    }

    RED.nodes.registerType("AHNetwork-restart", AHNetworkRestart);
};
