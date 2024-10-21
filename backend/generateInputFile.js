const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");

const inputDir = path.join(__dirname, "inputs");

if (!fs.existsSync(inputDir)) {
  fs.mkdirSync(inputDir, { recursive: true });
}

const generateInputFile = async (input) => {
  const jobId = uuid();  // Unique ID for the input file
  const inputFilename = `${jobId}.txt`;
  const inputFilePath = path.join(inputDir, inputFilename);
  await fs.writeFileSync(inputFilePath, input);
  return inputFilePath;
};

module.exports = { generateInputFile };
