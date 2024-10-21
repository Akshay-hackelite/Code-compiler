import axios from "axios";
import "./App.css";
import stubs from "./stubs";
import React, { useState, useEffect } from "react";
import moment from "moment";


function App() {
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [language, setLanguage] = useState("cpp");
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  const [inputFile, setInputFile] = useState(null);
  
  

  useEffect(() => {
    setCode(stubs[language]);
  }, [language]);

  useEffect(() => {
    const defaultLang = localStorage.getItem("default-language") || "cpp";
    setLanguage(defaultLang);
  }, []);

  let pollInterval;
  const handleCodeFileChange = (e) => {
    setCodeFile(e.target.files[0]);
    setCode("");
  };

  const handleInputFileChange = (e) => {
    setInputFile(e.target.files[0]);
    setInput("");
  };
  const handleInputChange = (e) => {
    setInput(e.target.value);
  };
  const handleSubmit = async () => {
  
    const formData = new FormData();
    
    // If files are provided, append them to form data
    if (codeFile) formData.append('codeFile', codeFile);
    if (inputFile) formData.append('inputFile', inputFile);

    /*const payload = {
      language,
      code,input
    };*/
    formData.append('code', code); 
    formData.append('input', input);
    formData.append('language', language);
    try {
      setOutput("");
      setStatus(null);
      setJobId(null);
      setJobDetails(null);
 
      //const { data } = await axios.post("http://localhost:5001/run", payload);
      const {data} = await axios.post('http://localhost:5001/run', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      console.log(data);
      if (data.jobId) {
        setJobId(data.jobId);
        setStatus("Submitted.");

        // poll here
        pollInterval = setInterval(async () => {
          const { data: statusRes } = await axios.get(
            `http://localhost:5001/status`,
            {
              params: {
                id: data.jobId,
              },
            }
          );
          const { success, job, error } = statusRes;
          console.log(statusRes);
          if (success) {
            const { status: jobStatus, output: jobOutput } = job;
            setStatus(jobStatus);
            setJobDetails(job);
            if (jobStatus === "pending") return;
            setOutput(jobOutput);
            clearInterval(pollInterval);
          } else {
            console.error(error);
            setOutput(error);
            setStatus("Bad request");
            clearInterval(pollInterval);
          }
        }, 1000);
      } else {
        setOutput("Retry again.");
      }
    } catch (error) {
      if (error.response) {
        const errMsg = error.response.data.err ? error.response.data.err.stderr : error.response.data.error;
        setOutput(errMsg || "An unknown error occurred."); // Fallback message
      }  else {
      setOutput("Please retry submitting.");
      }
    }
  };

  const setDefaultLanguage = () => {
    localStorage.setItem("default-language", language);
    console.log(`${language} set as default!`);
  };

  const renderTimeDetails = () => {
    if (!jobDetails) {
      return "";
    }
    let { submittedAt, startedAt, completedAt } = jobDetails;
    let result = "";
    submittedAt = moment(submittedAt).toString();
    result += `Job Submitted At: ${submittedAt}  `;
    if (!startedAt || !completedAt) return result;
    const start = moment(startedAt);
    const end = moment(completedAt);
    const diff = end.diff(start, "seconds", true);
    result += `Execution Time: ${diff}s`;
    return result;
  };

  return (
    <div className="App">
      <h1 class="head"><span class="compile">Compile</span><span class="it">It</span></h1>
      <div className="compiler-container">
        <div className="code-editor">
          <label>Language:</label>
          <select
            value={language}
            onChange={(e) => {
              const shouldSwitch = window.confirm(
                "Are you sure you want to change language? WARNING: Your current code will be lost."
              );
              if (shouldSwitch) setLanguage(e.target.value);
            }}
          >
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="py">Python</option>
            <option value="java">Java</option>
          </select>
          <br />
          <button onClick={setDefaultLanguage}>Set Default</button>
          <br />
          <label>Attach Code:</label>
          <input type="file" onChange={handleCodeFileChange} />
          <br />
          <textarea
            className="code-input"
            rows="20"
            cols="75"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          ></textarea>
        </div>
        <div class="preview">
          {code}
          </div>
        <div className="io-section">
          <label class="std">STDIN</label>
          <input type="file" onChange={handleInputFileChange} />
          <textarea
            rows="5"
            cols="50"
            placeholder="Provide input for your code here"
            value={input}
            onChange={handleInputChange}
          ></textarea>
          <br />
        
          <button type="button" onClick={handleSubmit} class="btn btn-outline-success sub">Run</button>
       
          <label class="std">STDOUT</label>
          <div className="output-section">
       
            <p>{status}</p>
            <p>{jobId ? `Job ID: ${jobId}` : ""}</p>
            <p>{renderTimeDetails()}</p>
            <pre>{output ? `Output: ${output}` : ""}</pre>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;
