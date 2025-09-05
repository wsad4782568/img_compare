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
