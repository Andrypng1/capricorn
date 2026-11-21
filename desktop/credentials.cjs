const { spawn } = require("node:child_process");
const { join } = require("node:path");

function credential(action, id, password = "") {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Identificador de enlace inválido.");
  const executable = join(__dirname.replace("app.asar", "app.asar.unpacked"), "credentials.exe");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [action, id], { windowsHide:true, stdio:["pipe","pipe","ignore"] });
    const output = [];
    child.stdout.on("data", (part) => output.push(part));
    child.stdin.on("error", () => undefined);
    child.once("error", () => reject(new Error("No se pudo abrir el Administrador de credenciales de Windows.")));
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else if (code === 2) resolve(null);
      else reject(new Error("El Administrador de credenciales de Windows rechazó la operación."));
    });
    child.stdin.end(password, "utf8");
  });
}

module.exports = { credential };
