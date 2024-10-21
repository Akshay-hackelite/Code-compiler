const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const outputPath = path.join(__dirname, "outputs");

if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true });
}

const executeCpp = (filepath,inputFilePath) => {
  const jobId = path.basename(filepath).split(".")[0];
  const outPath = path.join(outputPath, `${jobId}.out`);

  return new Promise((resolve, reject) => {
     // Check if input file exists; if not, don't include input in execution
     const inputCommand = inputFilePath ? `< ${inputFilePath}` : "";
    exec(
     // `g++ ${filepath} -o ${outPath} && cd ${outputPath} && ./${jobId}.out`,
      `g++ ${filepath} -o ${outPath} && ${outPath}${inputCommand}`, 
      (error, stdout, stderr) => {
        error && reject({ error, stderr });
        stderr && reject(stderr);
        resolve(stdout);
      }
    );
  }); 
};

module.exports = {
  executeCpp,
};
