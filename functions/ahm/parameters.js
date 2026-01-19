module.exports = {
    object: function () {
        return {
            sysexHeader: {
                allCall: [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x12, 0x01, 0x00],
                currentHeader: undefined
            },

            recieveBuffer: Buffer.from([]),
            processTimeout: undefined,
            syncActive: true,
            syncTimeout: undefined,
            waitingInit: [],
            totalChannelSelection: [64, 64, 32], //[inputs, zones, control groups]

            // === Funciones ===
            functions: {
                muteControl: require("./muteControl.js").object(),
                faderLevel: require("./faderLevel.js").object(),
                zoneSendMuteControl: require("./zoneSendMuteControl.js").object(),
                zoneSendFaderLevel: require("./zoneSendFaderLevel.js").object(),
                sceneRecall: require("./sceneRecall.js").object(),
            },

            // === Reset ===
            reset: function () {
                this.sysexHeader.currentHeader = undefined;
                this.syncActive = true;

                Object.keys(this.functions).forEach(function (key) {
                    try { 
                        if(this.functions[key].reset) this.functions[key].reset(); 
                    } catch (e) { }
                }.bind(this));
            },

            // === Recibir mensajes ===
            recieve: function (msg, midiChannel, server, callback) {
                const object = this;
                let value = [];

                object.recieveBuffer = Buffer.concat([object.recieveBuffer, msg]);

                // Procesar buffer después de 100ms
                clearTimeout(object.processTimeout);
                object.processTimeout = setTimeout(function () {
                    Object.keys(object.functions).forEach(function (key) {
                        const temp = object.functions[key].recieve
                            ? object.functions[key].recieve(midiChannel, object.recieveBuffer, server)
                            : false;
                        if (temp !== false && temp !== true) value.push(temp);
                    });
                    callback(value);
                }, 100);

                // Procesar sync
                clearTimeout(object.syncTimeout);
                object.syncTimeout = setTimeout(function () {
                    if (object.syncActive === true) {
                        if (object.waitingInit.length > 0) {
                            const fn = object.functions[object.waitingInit.pop()];
                            if(fn && typeof fn.initial === "function") fn.initial(server, midiChannel);
                        } else {
                            object.syncActive = false;
                            const finalValue = [];
                            Object.keys(object.functions).forEach(function (key) {
                                if(object.functions[key].getData) {
                                    const temp = object.functions[key].getData();
                                    if(temp !== false && temp !== true) finalValue.push(temp);
                                }
                            });
                            callback([finalValue]);
                        }
                    }
                    object.recieveBuffer = Buffer.from([]);
                }, 3000);

                return true;
            },

            // === Generar paquete MIDI ===
            generatePacket: function (msg, server, midiChannel, returnPayload) {
                let value = false;
                Object.keys(this.functions).forEach(function (key) {
                    if (value === false && this.functions[key].generatePacket) {
                        value = this.functions[key].generatePacket(msg, server, midiChannel, returnPayload);
                    }
                }.bind(this));
                return value;
            },

            // === Ping (dummy por ahora) ===
            sendPing: function (server, midiChannel, successFunction) {
                //if(successFunction) successFunction(false);
                return false;
            },

            // === Inicialización de la conexión ===
            initialConnection: function (server, midiChannel, callback) {
                const temp = this;

                // Setup de todas las funciones
                Object.keys(temp.functions).forEach(function (key) {
                    const mode = temp.functions[key];
                    if(mode.setup) mode.setup(temp);
                });

                // Inicializar la primera función de manera segura
                const keys = Object.keys(temp.functions);
                if(keys.length > 0) {
                    const firstFunc = temp.functions[keys[0]];
                    if(firstFunc && typeof firstFunc.initial === "function") {
                        firstFunc.initial(server, midiChannel);
                    }
                }

                // Llenar waitingInit y llamar a initial de cada función si existe
                temp.waitingInit = Object.keys(temp.functions).slice(); // copia de keys
                while(temp.waitingInit.length > 0) {
                    const fnName = temp.waitingInit.pop();
                    const fnObj = temp.functions[fnName];
                    if(fnObj && typeof fnObj.initial === "function") {
                        fnObj.initial(server, midiChannel);
                    }
                }

                return true;
            }
        }
    }
}
