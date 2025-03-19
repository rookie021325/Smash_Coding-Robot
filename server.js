// 加载环境变量配置
require('dotenv').config();

// 导入必要的依赖包
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const OpenAI = require('openai');

// 创建Express应用实例
const app = express();

// 使用中间件
app.use(bodyParser.json()); // 解析JSON格式的请求体
app.use(cors()); // 启用跨域资源共享
app.use(express.static('public')); // 提供静态文件服务

// 添加路由重定向
app.get('/', (req, res) => {
  res.redirect('/register.html');
});

// 初始化OpenAI配置
const openai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY, // 使用环境变量获取API密钥
    baseURL: "https://api.deepseek.com" // 设置DeepSeek API的基础URL
});

const userHistory = {}; // 用于保存用户历史记录

// 处理代码分析请求的路由
app.post('/api/process', async (req, res) => {
    const { code, action, username, language, description } = req.body;
    console.log('Received request:', { code, action });

    try {
        // 默认的提示词模板
        let content = `你是一个编程专家。请${action}以下代码，并确保所有注释和说明都是中文，而代码保持不变：${code}`;

        // 根据不同的操作类型，使用不同的提示词
        switch (action) {
            case 'refactor': // 代码重构
                content = `请分析以下${language}代码的可优化点，按优先级排序并给出修改方案：代码：${code}。优化方向：${description || '性能/可读性/健壮性'}。要求：1. 对比修改前后的代码差异 2. 解释每个优化点的收益`;
                break;
            case 'debug': // 调试代码
                content = `诊断并修复以下${language}代码的问题：代码：${code}。错误现象："${description}"。要求：1. 定位根本原因 2. 提供修复后的代码 3. 给出防止复现的建议`;
                break;
            case 'comment': // 添加注释
                content = `为以下${language}代码添加注释：代码：${code}。要求：1. 函数级文档字符串 2. 关键逻辑行内注释 3. 使用中文术语解释复杂算法`;
                break;
            case 'generate': // 代码生成
                content = `你是一个资深${language}开发者。请严格按以下要求生成代码：需求描述："${code}"。要求：1. 符合${language}最新语法规范 2. 添加必要异常处理 3. 输出格式：代码块`;
                break;
            default:
                content = `请用中文处理以下请求，并确保代码保持不变：${code}`;
        }

        // 构建发送给API的消息
        const messages = [
            { role: "user", content }
        ];

        // 调用DeepSeek API
        const response = await openai.chat.completions.create({
            model: "deepseek-reasoner",
            messages,
            stream: true
        });

        // 收集流式响应的内容
        let reasoningContent = "";
        let finalContent = "";
        for await (const chunk of response) {
            if (chunk.choices[0].delta.reasoning_content) {
                reasoningContent += chunk.choices[0].delta.reasoning_content;
            } else {
                finalContent += chunk.choices[0].delta.content;
            }
        }

        // 后处理规则
        let formattedContent;
        switch (action) {
            case 'generate':
                formattedContent = `<pre><code>${finalContent}</code></pre>`;
                break;
            case 'refactor':
                formattedContent = `<div class="diff-view">${finalContent}</div>`;
                break;
            case 'comment':
                formattedContent = `<div class="comment-block">${finalContent}</div>`;
                break;
            case 'debug':
                formattedContent = `<div class="error-analysis">${finalContent}</div>`;
                break;
            default:
                formattedContent = finalContent;
        }

        // 保存用户历史记录
        if (!userHistory[username]) {
            userHistory[username] = [];
        }
        userHistory[username].push({ code, action, timestamp: new Date() });

        // 返回处理结果
        console.log('API response:', formattedContent);
        res.json(formattedContent);
    } catch (error) {
        // 错误处理
        console.error('Error processing request:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Error processing request' });
    }
});

const mongoose = require('mongoose');

const bcrypt = require('bcrypt');

// 用户模型
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// 连接MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smash')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// 注册API
app.post('/api/register', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 检查用户名是否存在
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: '用户名已存在' });
        }
        
        // 使用bcrypt加密密码
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // 创建新用户
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        
        res.json({ success: true });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 登录API
app.post('/api/login', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 查找用户
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: '用户名或密码错误' });
        }
        
        // 验证密码
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: '用户名或密码错误' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 获取用户历史记录的路由
app.get('/api/history', (req, res) => {
    const { username } = req.query;
    res.json(userHistory[username] || []);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
