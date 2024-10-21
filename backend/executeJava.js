const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const executeJava = (filepath, inputFilePath) => {
    const className = "Main"; // The class name in your Java code
    const classPath = path.dirname(filepath);
  
    return new Promise((resolve, reject) => {
        const inputCommand = inputFilePath ? ` < ${inputFilePath}` : "";

        // Compile the Java file
        exec(`javac ${filepath}`, (error, stdout, stderr) => {
            if (error) return reject({ error, stderr });
            if (stderr) return reject(stderr);

            // Run the compiled Java class
            exec(`java -cp ${classPath} ${className} ${inputCommand}`, (error, stdout, stderr) => {
                if (error) return reject({ error, stderr });
                if (stderr) return reject(stderr);
                resolve(stdout);
            });
        });
    });
};

module.exports = {
    executeJava,
  };
  