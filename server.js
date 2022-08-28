//基于node+express
const express = require('express'),
    fs = require('fs'),
    bodyParser = require('body-parser'),
    multiparty = require('multiparty'),
    SparkMD5 = require('spark-md5');

/*-CREATE SERVER-*/
const app = express(),
    PORT = 8888,
    HOST = 'http://127.0.0.1',
    HOSTNAME = `${HOST}:${PORT}`;
    //通过listen方式去启动一个服务
app.listen(PORT, () => {
    console.log(`THE WEB SERVICE IS CREATED SUCCESSFULLY AND IS LISTENING TO THE PORT：${PORT}，YOU CAN VISIT：${HOSTNAME}`);
});

/*-中间件-*/
app.use((req, res, next) => {
    //允许任何客户端发起请求
    res.header("Access-Control-Allow-Origin", "*");
    req.method === 'OPTIONS' ? res.send('CURRENT SERVICES SUPPORT CROSS DOMAIN REQUESTS!') : next();
});
app.use(bodyParser.urlencoded({
    //限制请求传过来数据量的最大值
    extended: false,
    limit: '1024mb'
}));

/*-API-*/


// 检测文件是否存在
const exists = function exists(path) {
    return new Promise(resolve => {
        fs.access(path, fs.constants.F_OK, err => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
};

// 创建文件并写入到指定的目录 & 返回客户端结果
const writeFile = function writeFile(res, path, file, filename, stream) {
    return new Promise((resolve, reject) => {
        if (stream) {
            try {
                let readStream = fs.createReadStream(file.path),
                    writeStream = fs.createWriteStream(path);
                readStream.pipe(writeStream);
                readStream.on('end', () => {
                    resolve();
                    fs.unlinkSync(file.path);
                    res.send({
                        code: 0,
                        codeText: 'upload success',
                        originalFilename: filename,
                        servicePath: path.replace(__dirname, HOSTNAME)
                    });
                });
            } catch (err) {
                reject(err);
                res.send({
                    code: 1,
                    codeText: err
                });
            }
            return;
        }
        fs.writeFile(path, file, err => {
            if (err) {
                reject(err);
                res.send({
                    code: 1,
                    codeText: err
                });
                return;
            }
            resolve();
            res.send({
                code: 0,
                codeText: 'upload success',
                originalFilename: filename,
                servicePath: path.replace(__dirname, HOSTNAME)
            });
        });
    });
};

// 延迟函数
const delay = function delay(interval) {
    typeof interval !== "number" ? interval = 1000 : null;
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, interval);
    });
};

// 基于multiparty插件实现文件上传处理 & form-data解析
const uploadDir = `${__dirname}/upload`;

/**
 * 
 * @param {*} req  客户端传递的信息
 * @param {*} auto  是否允许插件自动对文件进行处理
 * @returns 
 * multiparty的缺点：无法对重复图片进行处理
 */
const multiparty_upload = function multiparty_upload(req, auto) {
    typeof auto !== "boolean" ? auto = false : null;
    let config = {
        maxFieldsSize: 200 * 1024 * 1024,  //限制文件大小为200MB
    };
    //如果设为自动处理，会自动把文件存放到uploadDir定义的目录结构下
    if (auto) config.uploadDir = uploadDir;
    return new Promise(async (resolve, reject) => {
        await delay(); //为了测试效果更明显，手动加了个延迟函数，默认值是1s
        //multiparty插件提供一个Form方法，用来根据config配置项，把req里面传递过来的formData数据进行解析parse
        new multiparty.Form(config)
            .parse(req, (err, fields, files) => {
                if (err) {
                    reject(err); //通过reject()方法将Promise状态设置为rejected
                    return;
                }
                //解析成功：
                resolve({
                    fields,  //传过来的filename
                    files  //传过来的file
                });
                //通过插件处理，会把传过来的文件名称处理成特殊值，避免多客户端传递同名文件
            });
    });
};

// 单文件上传处理「FORM-DATA」
/**
 * req：request客户端传过来的信息
 * res：response对象提供了一些方法让我们可以给客户端返回一些信息
 */
app.post('/upload_single', async (req, res) => {
    try {
        let {
            files
        } = await multiparty_upload(req, true);
        let file = (files.file && files.file[0]) || {};
        res.send({
            code: 0,
            codeText: 'upload success',
            originalFilename: file.originalFilename,
            //将服务器中存储文件的地址返回
            servicePath: file.path.replace(__dirname, HOSTNAME)
        });
    } catch (err) {
        //上传失败
        res.send({
            code: 1,
            codeText: err
        });
    }
});

app.post('/upload_single_name', async (req, res) => {
    try {
        let {
            fields,
            files
        } = await multiparty_upload(req);
        let file = (files.file && files.file[0]) || {},
            filename = (fields.filename && fields.filename[0]) || "",
            path = `${uploadDir}/${filename}`,
            isExists = false;
        // 检测是否存在
        isExists = await exists(path);
        if (isExists) {
            res.send({
                code: 0,
                codeText: 'file is exists',
                originalFilename: filename,
                servicePath: path.replace(__dirname, HOSTNAME)
            });
            return;
        }
        writeFile(res, path, file, filename, true);
    } catch (err) {
        res.send({
            code: 1,
            codeText: err
        });
    }
});

// 单文件上传处理「BASE64」
app.post('/upload_single_base64', async (req, res) => {
    let file = req.body.file,
        filename = req.body.filename,
        //SparkMD5插件能够根据文件的内容最终生成一个hash值，不是我们传入的文件名
        //所以能够保证两个图片的名字不同，但内容相同时，也会生成相同的hash值，从而判断是否已存在该图片
        spark = new SparkMD5.ArrayBuffer(),
        suffix = /\.([0-9a-zA-Z]+)$/.exec(filename)[1],
        isExists = false,
        path;
    file = decodeURIComponent(file); //解密
    file = file.replace(/^data:image\/\w+;base64,/, "");  //截取到Base64的部分
    file = Buffer.from(file, 'base64'); //把bse64转成Buffer
    spark.append(file);
    //通过spark.end()方法拿到该hash值
    path = `${uploadDir}/${spark.end()}.${suffix}`;
    await delay();
    // 检测是否存在-减轻服务器端存储资源的压力
    //封装exists方法，用来检测文件是否已经存在
    isExists = await exists(path);
    if (isExists) {
        res.send({
            code: 0,
            codeText: 'file is exists',
            originalFilename: filename,
            servicePath: path.replace(__dirname, HOSTNAME)
        });
        return;
    }
    //封装writeFile方法，把文件写入到指定目录
    writeFile(res, path, file, filename, false);
});

// 大文件切片上传 & 合并切片
const merge = function merge(HASH, count) {
    return new Promise(async (resolve, reject) => {
        let path = `${uploadDir}/${HASH}`,
            fileList = [],
            suffix,
            isExists;
        isExists = await exists(path);
        //如果不存在这个临时目录，则报错
        if (!isExists) {
            reject('HASH path is not found!');
            return;
        }
        fileList = fs.readdirSync(path);
        if (fileList.length < count) {
            reject('the slice has not been uploaded!');
            return;
        }
        //否则把切片都合并成file，最后删除切片和临时目录，只留下这个文件
        fileList.sort((a, b) => {
            let reg = /_(\d+)/;
            return reg.exec(a)[1] - reg.exec(b)[1];
        }).forEach(item => {
            !suffix ? suffix = /\.([0-9a-zA-Z]+)$/.exec(item)[1] : null;
            fs.appendFileSync(`${uploadDir}/${HASH}.${suffix}`, fs.readFileSync(`${path}/${item}`));
            fs.unlinkSync(`${path}/${item}`);
        });
        fs.rmdirSync(path);
        resolve({
            path: `${uploadDir}/${HASH}.${suffix}`,
            filename: `${HASH}.${suffix}`
        });
    });
};
app.post('/upload_chunk', async (req, res) => {
    try {
        let {
            fields,
            files
        } = await multiparty_upload(req);
        let file = (files.file && files.file[0]) || {},
            filename = (fields.filename && fields.filename[0]) || "",
            path = '',
            isExists = false;
        // 创建存放切片的临时目录
        let [, HASH] = /^([^_]+)_(\d+)/.exec(filename);
        path = `${uploadDir}/${HASH}`;
        !fs.existsSync(path) ? fs.mkdirSync(path) : null;
        // 把切片存储到临时目录中
        path = `${uploadDir}/${HASH}/${filename}`;
        isExists = await exists(path);
        if (isExists) {
            res.send({
                code: 0,
                codeText: 'file is exists',
                originalFilename: filename,
                servicePath: path.replace(__dirname, HOSTNAME)
            });
            return;
        }
        writeFile(res, path, file, filename, true);
    } catch (err) {
        res.send({
            code: 1,
            codeText: err
        });
    }
});
app.post('/upload_merge', async (req, res) => {
    let {
        HASH,
        count
    } = req.body;
    try {
        let {
            filename,
            path
        } = await merge(HASH, count);
        res.send({
            code: 0,
            codeText: 'merge success',
            originalFilename: filename,
            servicePath: path.replace(__dirname, HOSTNAME)
        });
    } catch (err) {
        res.send({
            code: 1,
            codeText: err
        });
    }
});
app.get('/upload_already', async (req, res) => {
    let {
        HASH
    } = req.query;
    let path = `${uploadDir}/${HASH}`,
        fileList = [];
    try {
        fileList = fs.readdirSync(path);
        fileList = fileList.sort((a, b) => {
            let reg = /_(\d+)/;
            return reg.exec(a)[1] - reg.exec(b)[1];
        });
        res.send({
            code: 0,
            codeText: '',
            fileList: fileList
        });
    } catch (err) {
        res.send({
            code: 0,
            codeText: '',
            fileList: fileList
        });
    }
});

app.use(express.static('./'));
app.use((req, res) => {
    res.status(404);
    res.send('NOT FOUND!');
});