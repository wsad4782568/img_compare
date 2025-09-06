const express = require('express');
const bodyParser = require('body-parser');
const tencentcloud = require("tencentcloud-sdk-nodejs-intl-en");

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
    const differences = compareImageTexts(
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
function compareImageTexts(texts1, texts2) {
  const differences = [];
  
  // 提取文本内容以便快速比较
  const textContents1 = texts1.map(item => item.DetectedText);
  const textContents2 = texts2.map(item => item.DetectedText);
  
  // 找出只在第一张图中存在的文本
  texts1.forEach((textItem, index) => {
    if (!textContents2.includes(textItem.DetectedText)) {
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
  
  // 找出只在第二张图中存在的文本
  texts2.forEach((textItem, index) => {
    if (!textContents1.includes(textItem.DetectedText)) {
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
  
  return differences;
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
