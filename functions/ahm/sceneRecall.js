module.exports = {
  object: function () {
    return {
      parameters: undefined,
      data: {
        currentScene: undefined,
      },

      setup: function (parameters) {
        this.parameters = parameters;
      },

      reset: function () {
        this.data = {
          currentScene: undefined,
        };
      },

      //Send out
      generatePacket: function generatePacket(
        msg,
        server,
        midiChannel,
        callback
      ) {
        var self = this;

        if (msg.payload.function == "sceneRecall") {
          //Solicitar datos almacenados
          if (msg.payload.scene === undefined) {
            var retMsg = {
              payload: {
                function: "sceneRecall",
              },
            };
            Object.assign(retMsg.payload, self.data);
            callback(retMsg);
            return true;
          }

          //Validación escena
          var scene = parseInt(msg.payload.scene);
          if (isNaN(scene)) return "scene must be a number";
          if (scene < 1 || scene > 500) return "scene out of range (1–500)";

          //Calcular banco y program
          var bank = Math.floor((scene - 1) / 128);
          var program = (scene - 1) % 128;

          //Guardar internamente
          self.data.currentScene = scene;
          var retMsg = {
            payload: {
              function: "sceneRecall",
            },
          };
          Object.assign(retMsg.payload, self.data);
          callback(retMsg);

          //Enviar paquete MIDI real
          return Buffer.from([
            0xb0 + parseInt(midiChannel, 16),
            0x00,
            bank, // Bank Select MSB
            0xc0 + parseInt(midiChannel, 16),
            program, // Program Change
          ]);
        }

        return false;
      },

      //Received data
      recieve: function recieve(midiChannel, data, server, syncActive) {
        var self = this;
        var updated = false;

        for (var i = 0; i < data.length; i++) {
          //Coincidencia de Bank Select + Program Change
          if (
            data[i + 0] == 0xb0 + parseInt(midiChannel, 16) &&
            data[i + 1] == 0x00 &&
            data[i + 3] == 0xc0 + parseInt(midiChannel, 16)
          ) {
            var bank = data[i + 2];
            var program = data[i + 4];

            //Reconstruir número de preset
            var scene = bank * 128 + program + 1;
            self.data.currentScene = scene;
            updated = true;
          }
        }

        //Si hay actualización y no estamos en sync: enviar mensaje
        if (updated && self.parameters.syncActive == false) {
          var msg = {
            payload: {
              function: "sceneRecall",
            },
          };
          Object.assign(msg.payload, self.data);
          return msg;
        }

        if (updated) return true;
        return false;
      },

      //Send data
      getData() {
        var msg = {
          payload: {
            function: "sceneRecall",
          },
        };
        Object.assign(msg.payload, this.data);
        return msg;
      },

      sendPing: function sendPing(server, midiChannel, successFunction) {
        return false;
      },
    };
  },
};
