const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const path=require("path")
mongoose.connect(
  "mongodb://localhost/compilerdb",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
  (err) => {
    if(err){
      console.error(err);
    }
    console.log("Successfully connected to MongoDB: compilerdb");
  }
);

const { generateFile } = require("./generateFile");
const{generateInputFile}=require("./generateInputFile")

const { addJobToQueue } = require("./jobQueue");
const Job = require("./models/Job");

const app = express();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "codeFile") {
      cb(null, "uploads/code");
    } else if (file.fieldname === "inputFile") {
      cb(null, "uploads/input");
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); //middlewware to make json payload from frontend parsed and made it available in req.body

app.post("/run",upload.fields([{ name: "codeFile" }, { name: "inputFile" }]), async (req, res) => {

  let filepath = req.files['codeFile'] ? req.files['codeFile'][0].path : null;
  let inputFilePath = req.files['inputFile'] ? req.files['inputFile'][0].path : null;
  const language = req.body.language || 'cpp';

  // need to generate a c++ file with content from the request
  
  if (!filepath) {//if codefile is not attached
    const{code}=req.body;
    if(code===""){
  
       return res.status(400).json({ error:"Error: no code is there" });
    }

     filepath = await generateFile(language, code);//generate filepath for the usercode
  }
  if (!inputFilePath && req.body.input) { //if no input file is attached
    const{input}=req.body;
    if (input!=="") {
      inputFilePath = await generateInputFile(input);//if userinput there then generate inputfile path
    }
  }//if input null then inputfilepath is null
 


  // write into DB
  const job = await new Job({ language, filepath,inputFilePath}).save();
  const jobId = job["_id"];
  addJobToQueue(jobId);
  res.status(201).json({ jobId });
});

app.get("/status", async (req, res) => {
  const jobId = req.query.id;

  if (jobId === undefined) {
    return res
      .status(400)
      .json({ success: false, error: "missing id query param" });
  }

  const job = await Job.findById(jobId);

  if (job === undefined) {
    return res.status(400).json({ success: false, error: "couldn't find job" });
  }

  return res.status(200).json({ success: true, job });
});

app.listen(5001, () => {
  console.log(`Listening on port 5001!`);
});
