from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
import json
import pandas as pd
import io
import sys
from io import StringIO
import re
from typing import Dict

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this to restrict allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load OpenAI API key from environment variable
openai.api_key = os.getenv("OPENAI_API_KEY")

parsed_data = []

# Define Prompt model
class Prompt(BaseModel):
    prompt: str

# Endpoint to upload CSV file
@app.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)):
    global parsed_data
    if file.filename.endswith('.csv'):
        content = await file.read()
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
        parsed_data = df.to_dict(orient='records')
        columns = df.columns.tolist()  # 提取列名
        print("Data columns:", columns)  # 打印列名以调试
        return {"status": "success"}
    else:
        return {"status": "error", "message": "Only CSV files are allowed."}





def generate_vega_lite_spec(prompt: str) -> dict:
    """
    Generate a Vega-Lite specification based on the user's request and the provided dataset.
    """
    # Call OpenAI API
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "You are a data visualization assistant responsible for generating Vega-Lite specifications. Vega-Lite is a high-level grammar of interactive graphics that produces JSON specifications for data visualizations.You are responsible for converting user requests into valid Vega-Lite specifications in JSON format, based on the dataset provided."},
            {"role": "user", "content": prompt}
        ],
        response_format = {"type": "json_object"} 
    )

    # Extract AI reply content
    ai_reply = chat_completion.choices[0].message['content']
    print("This is the ", ai_reply)

    try:
        vega_lite_spec = json.loads(ai_reply)
    except json.JSONDecodeError as e:
        print("JSON decode error:", str(e))
        vega_lite_spec = {}

    return vega_lite_spec






def sanitize_input(query: str) -> str:
    """Sanitize input to the python REPL."""
    # Removes `, whitespace & python from start
    query = re.sub(r"^(\s|`)*(?i:python)?\s*", "", query)
    # Removes whitespace & ` from end
    query = re.sub(r"(\s|`)*$", "", query)
    return query

def execute_python_code(code: str, parsed_data) -> str:

    # Convert parsed_data to DataFrame
    df = pd.DataFrame(parsed_data)

    # Save the current standard output to restore later
    old_stdout = sys.stdout
    # Redirect standard output to a StringIO object to capture any output generated by the code execution
    sys.stdout = mystdout = StringIO()
    try:
        # Sanitize and execute the code
        cleaned_command = sanitize_input(code)
        # Provide df in the local variables
        exec(cleaned_command, {'df': df})
        # Restore the original standard output after code execution
        sys.stdout = old_stdout
        # Return any captured output from the executed code

        return mystdout.getvalue()
    except Exception as e:
        sys.stdout = old_stdout
        return repr(e)





# Define function descriptions
generate_vega_lite_spec_tool = {
    "name": "generate_vega_lite_spec",
    "description": "Generates a Vega-Lite specification for a chart based on the user's request and the provided dataset. Use this when the user asks for data visualization or chart generation.",
    "parameters": {
        "type": "object",
        "properties": {
            "user_query": {
                "type": "string",
                "description": "The user's request describing the desired chart."
            },
            "prompt": {
                "type": "string",
                "description": "The constructed prompt based on the dataset and user query."
            }
        },
        "required": ["prompt"],
    }
}

execute_python_code_tool = {
    "name": "execute_python_code",
    "description": "Executes Python code for data analysis on the dataset. Use this to perform data analysis tasks and computations on the dataset. The code should use the pandas DataFrame 'df' which contains the dataset. **The code should explicitly print the output in complete sentences using print().**",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "The Python code to execute. The code should use the pandas DataFrame 'df' for data analysis."
            }
        },
        "required": ["code"],
    }
}

# Tools list
tools = [generate_vega_lite_spec_tool, execute_python_code_tool]

# Tool mapping
tool_map = {
    "generate_vega_lite_spec": generate_vega_lite_spec,
    "execute_python_code": execute_python_code
}



def generate_summary_from_analysis(user_query: str, analysis_result: str) -> str:
    """
    Generate a complete sentence summary based on the user query and analysis result.
    """
    prompt = f"""
You are a data analyst assistant. A user asked: "{user_query}"

The data analysis assistant provided the following output:
"{analysis_result}"

Please provide a concise summary of the analysis result in complete sentences, suitable for presenting to the user. Ensure that the summary is clear and directly addresses the user's query.
"""

    print(prompt)

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "You are a helpful assistant who summarizes data analysis results."},
            {"role": "user", "content": prompt}
        ]
    )

    summary = response["choices"][0]["message"]["content"].strip()
    return summary



def agent_tool_calling_loop(user_message: str, prompt: str, max_iterations=10) -> dict:
    df = pd.DataFrame(parsed_data)
    columns = df.columns.tolist()  # 获取列名
    messages = [
        {
            "role": "system",
            "content": f"""
                You are a data assistant capable of generating Vega-Lite specifications and performing data analysis on the provided dataset. 
                The dataset you are working with has the following columns:{columns}.
                Use the supplied tools to assist the user.

                Available tools:

                1. generate_vega_lite_spec:
                - Description: Generates a Vega-Lite specification for a chart based on the user's request and the provided dataset.
                - Usage: Use this tool when the user asks for data visualization or chart generation.

                2. execute_python_code:
                - Description: Executes Python code for data analysis on the dataset. Use this to perform data analysis tasks and computations on the dataset. The code should use the pandas DataFrame 'df' which contains the dataset. The code should explicitly print the output using print().
                - Ensure that the generated code outputs results in complete sentences using `print()`, suitable for display to the user.
                Remember to use 'print()' to output the results in the execute_python_code tool.

                If the user's request is not related to the dataset or you cannot answer it, politely inform the user.

                Do not include any code or JSON in your final answer unless necessary.
                """
        },
        {"role": "user", "content": user_message}
    ]

    vega_lite_spec = None
    data_analysis_text = None
    final_answer = None

    i = 0
    while i < max_iterations:
        i += 1
        # Call OpenAI API with function calling capability
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",  # Ensure the model supports function calling
            messages=messages,
            functions=tools,
            function_call="auto"
        )

        response_message = response["choices"][0]["message"]

        # 如果 AI 给出了最终答案，退出循环
        if response_message.get("content"):
            final_answer = response_message["content"]
            break  # Exit the loop

        # 如果 AI 想要调用函数
        if response_message.get("function_call"):
            function_name = response_message["function_call"]["name"]
            arguments = json.loads(response_message["function_call"]["arguments"])

            print(f"Calling function: {function_name} with arguments: {arguments}")

            # Get the corresponding function
            function_to_call = tool_map.get(function_name)



            # Call the function and get the result
            if function_name == "generate_vega_lite_spec":
                function_response = function_to_call(prompt)
                vega_lite_spec = function_response  # Store the Vega-Lite spec
            elif function_name == "execute_python_code":
                function_response = function_to_call(arguments['code'], parsed_data)
                data_analysis_text = function_response  # Store the data analysis text
            else:
                function_response = "Function not found."

            # Add the assistant's message and function's response to the conversation
            messages.append(response_message)
            messages.append({
                "role": "function",
                "name": function_name,
                "content": json.dumps(function_response) if isinstance(function_response, dict) else function_response
            })
        else:
            # 如果既没有内容，也没有函数调用，退出循环
            break



#尝试部分
 # **在这里调用 AI 模型，将数据分析结果转化为完整的句子**
        if data_analysis_text:
            summary = generate_summary_from_analysis(user_message, data_analysis_text)
            data_analysis_text = summary  # 用生成的完整句子替换原始输出




    # Return the collected results
    return {
        "vegaLiteSpec": vega_lite_spec,
        "dataAnalysisText": data_analysis_text,
        "finalAnswer": final_answer
    }

@app.post("/process_query")
async def process_query(user_input: Dict[str, str]):
    user_message = user_input.get('message')
    prompt = user_input.get('prompt')
    if not user_message:
        raise HTTPException(status_code=400, detail="No message provided.")

    # Ensure parsed_data has been loaded
    if not parsed_data:
        return {"response": "Please upload a dataset first."}

    try:
        # Call the agent tool calling loop
        result = agent_tool_calling_loop(user_message, prompt)

        # Return both vegaLiteSpec, dataAnalysisText, and finalAnswer
        return {
            "vegaLiteSpec": result.get("vegaLiteSpec"),
            "dataAnalysisText": result.get("dataAnalysisText"),
            "finalAnswer": result.get("finalAnswer")
        }

    except Exception as e:
        print("Error:", str(e))
        raise HTTPException(status_code=500, detail=str(e))

# Root endpoint
@app.get("/")
async def read_root():
    return FileResponse('static/index.html')




