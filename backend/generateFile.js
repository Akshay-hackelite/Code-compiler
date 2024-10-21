const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");

const dirCodes = path.join(__dirname, "codes");//cross platform functionality

if (!fs.existsSync(dirCodes)) {
  fs.mkdirSync(dirCodes, { recursive: true });
}

const generateFile = async (format, content) => {
  const jobId = uuid();
  const filename = `${jobId}.${format}`; //name of the stored file in code folder 
  const filepath = path.join(dirCodes, filename);
  if (!content || content.trim() === "") {
    throw new Error("Content is missing or invalid.");
  }
  await fs.writeFileSync(filepath, content);
  return filepath;
};

module.exports = { 
  generateFile,
};
