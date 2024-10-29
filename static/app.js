document.addEventListener("DOMContentLoaded", function() {
    // Initialize event listeners
    const inputField = document.getElementById("user-input");

    // Listen for Enter key press in the input field
    inputField.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent default newline behavior
            sendMessage(); // Call the sendMessage function
        }
    });

    // Add click event to the file upload area
    document.getElementById('file-dropzone').addEventListener('click', function() {
        document.getElementById('file-input').click();
    });
});

// Clear Message
function clearMessages() {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = ''; // 清空聊天记录
}



// Allow drag over file dropzone
function allowDrag(event) {
    event.preventDefault();
}

// Handle file drop
function handleFileDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const latestFile = files[files.length - 1];
        handleFile(latestFile);
    }  
}

// Handle file selection (click)
function handleFileSelect(event) {
    const files = event.target.files;
    if (files.length > 0) {
        const latestFile = files[files.length - 1];
        handleFile(latestFile);
    }
}

// Global variable to store parsed data
let parsedData = [];

// Handle CSV file upload and error handling
function handleFile(file) {
    if (file && file.name.endsWith('.csv')) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const csvData = event.target.result;
            // Parse CSV file into JavaScript object array (using d3)
            parsedData = d3.csvParse(csvData, d3.autoType);
            // Display only the first 10 rows
            const previewData = parsedData.slice(0, 10);
            // Display table preview
            displayTablePreview(previewData);

            document.getElementById('toggle-button').style.display = 'block';
        };
        reader.readAsText(file);

        // Upload the CSV data to the backend
        uploadCSV(file);
    } else {
        // File upload error handling
        alert("Only CSV files are allowed.");
    }
}

// Upload CSV file to the backend
function uploadCSV(file) {
    const formData = new FormData();
    formData.append('file', file);

    fetch('https://HAI_Assignment3-1.onrender.com/upload_csv', {
        method: 'POST',
        body: formData
    })
    .then((response) => response.json())
    .then((data) => {
        if (data.status !== 'success') {
            alert('Failed to upload CSV file.');
        }
    })
    .catch((error) => {
        console.error('Error uploading CSV file:', error);
        alert('An error occurred while uploading the CSV file.');
    });
}

// Display table preview
function displayTablePreview(data) {
    const tableContainer = document.getElementById('table-preview');
    tableContainer.innerHTML = ''; // Clear previous table

    // Create table
    const table = document.createElement('table');
    table.className = 'table table-striped';

    // Create table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    Object.keys(data[0]).forEach(key => {
        const th = document.createElement('th');
        th.textContent = key;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    data.forEach(row => {
        const tr = document.createElement('tr');
        Object.values(row).forEach(value => {
            const td = document.createElement('td');
            td.textContent = value;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    tableContainer.appendChild(table);
    // Make the container visible
    tableContainer.style.display = 'block';
}

// Toggle table preview visibility
function toggleTablePreview() {
    const tableContainer = document.getElementById('table-preview');
    const toggleButton = document.getElementById('toggle-button');
    if (tableContainer.style.display === 'none') {
        tableContainer.style.display = 'block';
        toggleButton.textContent = 'Hide Table Preview';
    } else {
        tableContainer.style.display = 'none';
        toggleButton.textContent = 'Show Table Preview';
    }
}

// Detect data types
function detectDataTypes(data) {
    const dataTypes = {};
    const sampleRow = data[0];

    Object.keys(sampleRow).forEach(column => {
        const value = sampleRow[column];
        if (typeof value === 'number') {
            dataTypes[column] = 'quantitative';  // 数值型
        } else if (Object.prototype.toString.call(value) === '[object Date]') {
            dataTypes[column] = 'temporal';      // 时间型
        } else {
            dataTypes[column] = 'nominal';       // 分类型/字符串型
        }
    });

    return dataTypes;
}

// Construct prompt for Vega-Lite
function constructPromptForVegaLite(data, userQuery) {
    const columns = Object.keys(data[0]);       // 获取列名
    const sampleValues = data.slice(0, 20);     // 提取前20行作为示例
    // 提取并清理列名
    const dataTypes = detectDataTypes(data);    // 检测数据类型

    let dataTypeDescriptions = '';
    Object.keys(dataTypes).forEach(column => {
        dataTypeDescriptions += `${column} is of type ${dataTypes[column]}. `;
    });

    const prompt = `
    Based on a dataset with columns: ${columns.join(', ')}, where ${dataTypeDescriptions}, and sample values: ${JSON.stringify(sampleValues)}.

   **The exact field names you must use are: ${columns.join(', ')}. Use only these field names exactly as provided, including case sensitivity and spaces. Do not use any synonyms, abbreviations, or variations.**

    Please generate a Vega-Lite JSON specification for a chart that fulfills the following request:
    "${userQuery}".

    **Ensure that all field names used in the specification, especially in the "encoding" section, exactly match the provided column names.**

    If user's message/query/questions is not related to the dataset analysis (e.g., greetings, personal questions, or comments like "Hello", "Bye", "Love the movie", "How are you?", "Tell me a joke", "yes/no", "good/bad" etc.), you must return an empty Vega-Lite JSON object {}!

    If you cannot generate a valid Vega-Lite JSON specification based on the request and the provided data, you also must return an empty JSON object {}!

    Do not include the data values directly in the "data" field of the specification.
    Instead, use "data": {"values": "myData"}, assuming that "myData" will be provided during rendering.

    When using aggregate functions like "count", do not include parentheses or use them as field names. Use "aggregate": "count" and do not specify a "field" unless counting a specific field.

    Ensure that the chart uses appropriate visual encoding based on the data types and includes any necessary data transformations.

    When writing expressions (e.g., in "transform" filters), if a field name contains spaces or special characters, reference it using bracket notation. For example, use datum['Release Year'] instead of datum.Release Year.

    The generated JSON should include the "$schema": "https://vega.github.io/schema/vega-lite/v5.json" field.

    **Do not invent new field names or modify the existing ones.**

    Return only the JSON object without any additional text or explanation.

    Do not include any descriptions, comments, or explanations outside of the JSON object.

    Also, ensure no unnecessary fields are included and the chart is syntactically correct.
    `;

    console.log(prompt)
    return prompt;
}

console.log(prompt)

function sendMessage() {
    const inputField = document.getElementById("user-input");
    const chatContainer = document.getElementById("chat-container");
    const userMessage = inputField.value;

    if (userMessage) {
        // 显示用户消息（保持不变）
        const userMessageDiv = document.createElement('div');
        userMessageDiv.classList.add('user-message');
        userMessageDiv.innerHTML = `
            <div class='userName'>
                You
            </div>
            <div class='user-flex-container'>
                <div class='user-flex-container messageContainer'>
                    <div class='messageText'>
                        ${userMessage}
                    </div>
                </div>
                <div class='imageContainer'>
                    <img src="/static/user_avator.png" alt="userImage"> 
                </div>                     
            </div>
        `;
        chatContainer.appendChild(userMessageDiv);
        userMessageDiv.scrollIntoView({ behavior: 'smooth' });
        // 滚动到聊天底部
        chatContainer.scrollTop = chatContainer.scrollHeight;

        if (parsedData && parsedData.length > 0){
                   // **插入"正在处理"的消息和加载图标**
            const loadingMessageId = `loading-${Date.now()}`;
            const aiLoadingDiv = document.createElement('div');
            aiLoadingDiv.classList.add('ai-message');
            aiLoadingDiv.setAttribute('id', loadingMessageId);  // 设置唯一 ID
            aiLoadingDiv.innerHTML = `
                <div class='aiName'>
                    Robot
                </div>
                <div class='ai-flex-container'>
                    <div class='aiImageContainer'>
                        <img src="/static/ai_avator.png" alt="aiImage">  
                    </div>
                    <div class='ai-flex-container aiMessageContainer'>
                        <div class='messageText'>
                            I'm working on it
                            <span class="spinner">
                                <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <circle class="spinner_S1WN" cx="4" cy="12" r="3"/>
                                    <circle class="spinner_S1WN spinner_Km9P" cx="12" cy="12" r="3"/>
                                    <circle class="spinner_S1WN spinner_JApP" cx="20" cy="12" r="3"/>
                                </svg>
                            </span>
                        </div>
                    </div>
                </div> `;
            chatContainer.appendChild(aiLoadingDiv);
            aiLoadingDiv.scrollIntoView({ behavior: 'smooth' });
            
            

            
            // 使用前端的函数构建提示
            const prompt = constructPromptForVegaLite(parsedData, userMessage);

            // 发送用户消息和构建的提示到新的端点
            fetch("https://HAI_Assignment3-1/process_query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMessage, prompt: prompt }),
            })
            .then((response) => response.json())
            .then((data) => {
                // 获取加载消息的元素
                const aiMessageDiv = document.getElementById(loadingMessageId);
                if (data.vegaLiteSpec && Object.keys(data.vegaLiteSpec).length > 0) {
                    // 创建唯一的图表容器 ID
                    const uniqueChartId = `vega-chart-container-${Date.now()}`;
                    // 替换加载消息的内容
                    aiMessageDiv.innerHTML = `
                        <div class='aiName'>
                            Robot
                        </div>
                        <div class='ai-flex-container'>
                            <div class='aiImageContainer'>
                                <img src="/static/ai_avator.png" alt="aiImage">  
                            </div>
                            <div class='ai-flex-container aiMessageContainer'>
                                <div id="${uniqueChartId}" class="image_generate" style="width:auto; height: auto;"></div>
                                <div class='messageText' id="analysis-${uniqueChartId}"></div>
                            </div>
                        </div> `;
                    // 渲染 Vega-Lite 图表
                    renderVegaLiteChart(data.vegaLiteSpec, uniqueChartId);
                    // 显示数据分析结果（如果有）
                    if (data.dataAnalysisText) {
                        const analysisDiv = document.getElementById(`analysis-${uniqueChartId}`);
                        analysisDiv.textContent = data.dataAnalysisText;
                    }
                } else if (data.dataAnalysisText) {
                    // 只有数据分析结果，没有图表
                    // **修改这里，使用已有的 aiMessageDiv**
                    aiMessageDiv.innerHTML = `
                        <div class='aiName'>
                            Robot
                        </div>
                        <div class='ai-flex-container'>
                            <div class='aiImageContainer'>
                                <img src="/static/ai_avator.png" alt="aiImage">  
                            </div>
                            <div class='ai-flex-container aiMessageContainer'>
                                <div class='messageText'>
                                    ${data.dataAnalysisText}
                                </div>          
                            </div>
                        </div> `;
                } else {
                    // 未知响应，显示错误消息
                    // **修改这里，使用已有的 aiMessageDiv**
                    aiMessageDiv.innerHTML = `
                        <div class='aiName'>
                        Robot
                        </div>
                        <div class='ai-flex-container'>
                        <div class='aiImageContainer'>
                            <img src="/static/ai_avator.png" alt="aiImage">  
                        </div>
                        <div class='ai-flex-container aiMessageContainer'>
                            <div class='messageText'>
                                Sorry, I cannot answer the question that is not relevant to the dataset, please send your request again
                            </div>          
                        </div>
                        </div>
                    `;
                }
                // 滚动到聊天底部
                chatContainer.scrollTop = chatContainer.scrollHeight;
            })
            
            .catch((error) => {
                console.error("Error:", error);
                alert("An error occurred while processing your request. Please try again.");
            });
        } else {
            // 提示用户上传数据集（保持不变）
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.classList.add('ai-message');
            aiMessageDiv.innerHTML =  `
                <div class='aiName'>
                    Robot
                </div>
                <div class='ai-flex-container'>
                    <div class='aiImageContainer'>
                        <img src="/static/ai_avator.png" alt="aiImage">  
                    </div>
                    <div class='ai-flex-container aiMessageContainer'>
                        <div class='messageText'>
                            Please upload a dataset
                        </div>          
                    </div>
                </div> `;

            chatContainer.appendChild(aiMessageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        inputField.value = ""; // 清空输入框
    }
}

// Render Vega-Lite chart function
function renderVegaLiteChart(spec, chartId) {
    parsedData = parsedData.map(row => {
        const cleanedRow = {};
        for (const key in row) {
          const trimmedKey = key.trim();
          cleanedRow[trimmedKey] = row[key];
        }
        return cleanedRow;
      });
      



    if (spec.data && spec.data.values === 'myData') {
        // Inject the full dataset into the specification
        spec.data.values = parsedData;
    } else {
        // If the spec does not correctly reference data, set it manually
        spec.data = { values: parsedData };
    }

    // Output the generated specification for debugging
    console.log('Generated Vega-Lite Spec:', spec);

    // Render the chart using vegaEmbed
    vegaEmbed(`#${chartId}`, spec)
    .then((result) => {
        console.log('Chart rendered successfully');
    })
    .catch((error) => {
        console.error('Error rendering chart:', error);
        const chartContainer = document.getElementById(chartId);
        if (chartContainer) {
            chartContainer.innerHTML = 'Failed to render chart.';
        }
    });
}

