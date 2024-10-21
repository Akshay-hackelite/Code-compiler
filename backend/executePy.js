const { exec } = require("child_process");

const executePy = (filepath,inputFilePath) => {
  
  return new Promise((resolve, reject) => {
    const inputCommand = inputFilePath ? ` < ${inputFilePath}` : "";
    exec(
     // `python ${filepath}`,
     `python ${filepath}${inputCommand}`,
      (error, stdout, stderr) => {
        error && reject({ error, stderr });
        stderr && reject(stderr);
        resolve(stdout);
      }
    );
  });
};

module.exports = {
  executePy,
};
