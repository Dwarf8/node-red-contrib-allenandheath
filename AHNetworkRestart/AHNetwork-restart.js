module.exports = function(RED) {
    function AHNetworkRestart(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Obtiene el config node AHNetwork
        const network = RED.nodes.getNode(config.network);

        if (!network) {
            node.error("No se encontró el nodo AHNetwork configurado");
            node.status({fill:"red", shape:"ring", text:"No network"});
            return;
        }

        node.status({fill:"gray", shape:"dot", text:"Waiting for restart"});

        node.on("input", function(msg) {
            node.log("=== AHNetwork-restart: input recibido ===");
            
            if (!network || typeof network.restart !== "function") {
                node.error("No se puede reiniciar: network no válido o no inicializado");
                node.status({fill:"red", shape:"ring", text:"No network"});
                return;
            }

            // Logs antes de restart
            node.log("Iniciando restart del nodo AHNetwork...");
            node.status({fill:"blue", shape:"dot", text:"Restarting..."});

            // Delay para asegurarse de que el nodo AHNetwork está inicializado
            setTimeout(() => {
                try {
                    network.restart();
                    node.log("Restart ejecutado con éxito");
                    node.status({fill:"green", shape:"dot", text:"Restarted"});
                } catch (err) {
                    node.error(`Error ejecutando restart: ${err.message}`, err);
                    node.status({fill:"red", shape:"ring", text:"Error"});
                }
            }, 500); // 500ms delay seguro
        });

        node.on("close", function() {
            node.log("AHNetwork-restart cerrado");
        });
    }

    RED.nodes.registerType("AHNetwork-restart", AHNetworkRestart);
};
