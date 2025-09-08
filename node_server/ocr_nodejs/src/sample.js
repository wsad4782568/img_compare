const express = require('express');
const bodyParser = require('body-parser');
const tencentcloud = require("tencentcloud-sdk-nodejs-intl-en");
const axios = require('axios');

// 初始化Express应用
const app = express();
const port = process.env.PORT || 3000;
const host = '0.0.0.0'; // 监听所有可用网络接口

// 中间件配置
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 允许跨域请求（前端调用需要）
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 腾讯云OCR配置
const OcrClient = tencentcloud.ocr.v20181119.Client;
const models = tencentcloud.ocr.v20181119.Models;
const Credential = tencentcloud.common.Credential;
const ClientProfile = tencentcloud.common.ClientProfile;
const HttpProfile = tencentcloud.common.HttpProfile;

// 实例化认证对象（生产环境建议使用环境变量）
let cred = new Credential(
    process.env.TENCENTCLOUD_SECRET_ID || 'IKIDpXN7ez6GJAnCQSGsGTSDnCUuIj4HwY9n',
    process.env.TENCENTCLOUD_SECRET_KEY || 'Zq088xb4LSNzTjldAsW0MYWJsHTTIyRk'
);

// 实例化HTTP选项
let httpProfile = new HttpProfile();
httpProfile.endpoint = "ocr.intl.tencentcloudapi.com";

// 实例化客户端选项
let clientProfile = new ClientProfile();
clientProfile.httpProfile = httpProfile;

// 实例化OCR客户端对象
let client = new OcrClient(cred, "", clientProfile);

// OCR识别API端点
app.post('/api/recognize-image', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        
        if (!imageUrl) {
            return res.status(400).json({ 
                success: false, 
                error: 'imageUrl参数是必需的' 
            });
        }
        
        let reqOcr = new models.GeneralAccurateOCRRequest();
        let params = { ImageUrl: imageUrl };
        reqOcr.from_json_string(JSON.stringify(params));
        
        // 调用腾讯云OCR服务
        const response = await new Promise((resolve, reject) => {
            client.GeneralAccurateOCR(reqOcr, function(err, response) {
                if (err) {
                    console.error('调用腾讯云OCR服务失败:', err);
                    reject(err);
                    return;
                }
                resolve(response);
            });
        });
        
        res.json({ 
            success: true, 
            result: JSON.parse(response.to_json_string()) 
        });
    } catch (error) {
        console.error('OCR处理错误:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'OCR请求处理失败' 
        });
    }
});

// 后端API示例（Node.js + Express）
app.post('/api/compare-documents', async (req, res) => {
  try {
    const { image1Result, image2Result } = req.body;
    
    // 直接处理图片识别结果，计算差异
    const differences = await compareImageTexts(
      image1Result.result.TextDetections, 
      image2Result.result.TextDetections
    );
    
    // 返回差异分析结果
    res.json({ differences });
  } catch (error) {
    console.error('比较文档失败:', error);
    res.status(500).json({ error: '分析失败', message: error.message });
  }
});

// 比较两张图片中的文本差异
async function compareImageTexts(texts1, texts2) {
  const differences = [];
  const imgtext_1 = [];
  const imgtext_2 = [];

  // 一个函数用于标准化文本，去除空格和符号
  const normalizeText = (text) => text.replace(/[^\u4e00-\u9fa5\w]+/g, '').toLowerCase();

  // 提取并标准化文本内容以便快速比较
  const textContents1 = texts1.map(item => normalizeText(item.DetectedText));
  const textContents2 = texts2.map(item => normalizeText(item.DetectedText));

  // 找出只在第一张图中存在的文本
  texts1.forEach((textItem, index) => {
    if (!textContents2.includes(normalizeText(textItem.DetectedText))) {
      imgtext_1.push(textItem.DetectedText)
    }
  });

  // 找出只在第二张图中存在的文本
  texts2.forEach((textItem, index) => {
    if (!textContents1.includes(normalizeText(textItem.DetectedText))) {
      imgtext_2.push(textItem.DetectedText)
    }
  });

  // 调用ADP继续对比差异
  const responseData = await postAiChat(`imgtext_1=${JSON.stringify(imgtext_1)}
  imgtext_2=${JSON.stringify(imgtext_2)}`)
  console.log('responseData = ', responseData)
  const result = parseComplexData(responseData);
    if (result) {
          texts1.forEach((textItem, index) => {
            if(result.imgtext_1.includes(textItem.DetectedText)) {
                // 计算多边形的边界框
                const bbox = calculateBoundingBox(textItem.Polygon);
                differences.push({
                    id: `only-in-1-${index}`,
                    type: 'only-in-first',
                    image1: {
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height,
                    text: textItem.DetectedText
                    },
                    image2: null
                });
            }
        });
        texts2.forEach((textItem, index) => {
            if(result.imgtext_2.includes(textItem.DetectedText)) {
                // 计算多边形的边界框
                const bbox = calculateBoundingBox(textItem.Polygon);
                differences.push({
                    id: `only-in-2-${index}`,
                    type: 'only-in-second',
                    image1: null,
                    image2: {
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height,
                    text: textItem.DetectedText
                    }
                });
            }
        });
    }

  return differences;
}

// 请求ADP的借口
async function postAiChat(params) {
  try {
    // 生成随机的sessionId
    const sessionId = 'session-1757343169002' //generateUUID(); // ⇨ '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    // 准备请求数据
    const requestData = {
      content: params,
      sessionId: sessionId
    };
    // 发送POST请求到AI聊天接口
    const response = await axios.post(
      'https://mrtest.yz-intelligence.com/ai/maindray/ai_test/chat',
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    // 返回接口响应数据
    return response.data;
  } catch (error) {
    console.error('调用AI聊天接口失败:', error.response?.data || error.message);
    throw new Error('调用AI聊天接口失败: ' + (error.response?.data?.message || error.message));
  }
}

// 计算多边形的边界框
function calculateBoundingBox(polygon) {
  if (!polygon || polygon.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  // 找到最小和最大的X、Y坐标
  const xs = polygon.map(point => point.X);
  const ys = polygon.map(point => point.Y);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// 判断两个文本项是否位置相近
function areTextItemsClose(text1, text2, threshold = 100) {
  const bbox1 = calculateBoundingBox(text1.Polygon);
  const bbox2 = calculateBoundingBox(text2.Polygon);
  
  // 计算两个边界框中心点之间的距离
  const center1 = {
    x: bbox1.x + bbox1.width / 2,
    y: bbox1.y + bbox1.height / 2
  };
  
  const center2 = {
    x: bbox2.x + bbox2.width / 2,
    y: bbox2.y + bbox2.height / 2
  };
  
  // 欧氏距离
  const distance = Math.sqrt(
    Math.pow(center1.x - center2.x, 2) + 
    Math.pow(center1.y - center2.y, 2)
  );
  
  return distance < threshold;
}

// 测试接口
app.get('/', (req, res) => {
    res.json({ 
        message: 'OCR识别API服务已启动', 
        status: 'running',
        endpoint: `http://150.109.72.200:${port}/api/recognize-image`
    });
});

// 启动服务器，明确指定主机地址
app.listen(port, host, () => {
    console.log(`OCR识别服务已启动，监听地址: http://${host}:${port}`);
    console.log(`通过IP访问API: http://150.109.72.200:${port}/api/recognize-image`);
});

// utils工具函数
// 生成随机ID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 解析原始数据字符串
 * 步骤：1. 提取有效data块 2. 解析content 3. 转换为JS对象
 */
function parseComplexData(rawStr) {
  try {
    // 步骤1：分割原始字符串，提取包含content的有效data块
    // 按换行分割，过滤空行和[DONE]块
    const dataBlocks = rawStr.split('\n')
      .map(block => block.trim())
      .filter(block => block.startsWith('data:') && !block.includes('[DONE]'));

    if (dataBlocks.length === 0) {
      throw new Error("未找到有效数据块");
    }

    // 步骤2：处理有效data块（取第一个有效块）
    const validDataBlock = dataBlocks[0];
    // 移除'data:'前缀，得到JSON字符串
    const jsonStr = validDataBlock.replace(/^data:/, '');

    // 步骤3：解析外层JSON，获取content
    const outerData = JSON.parse(jsonStr);
    const content = outerData.content;
    if (!content) {
      throw new Error("content字段不存在");
    }

    // 步骤4：处理content中的数组定义（转换为JSON格式）
    let parsedContent = content
      // 将变量定义转为JSON键值对（imgtext_1 = [...] → "imgtext_1": [...]）
      .replace(/(\w+)\s*=\s*/g, '"$1": ')
      // 在数组结束与下一个键之间添加逗号（修复JSON语法）
      .replace(/]\s+"/g, '], "');

    // 包裹为完整JSON对象
    parsedContent = `{ ${parsedContent} }`;
    // 清理可能的多余逗号
    parsedContent = parsedContent.replace(/,\s*([}\]])/g, ' $1');

    // 步骤5：解析最终结果
    return JSON.parse(parsedContent);

  } catch (error) {
    console.error('解析失败:', error);
    console.log('错误位置数据:', error.message.includes('JSON') ? jsonStr : content || rawStr);
    return null;
  }
}
// 执行转换
// const result = parseComplexData(rawString);