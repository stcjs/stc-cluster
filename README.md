# stc-cluster

使用 cluster 来调用任务，可以利用多核 CPU 来提升 CPU 密集型任务。比如：代码压缩，ES6 转译为 ES5 等操作。

## 安装

```js
npm install stc-cluster
```

## 使用

```js
import StcCluster from 'stc-cluster';
let instance = new StcCluster({
  workers: 0 //子进程个数，默认为 cpu 核数
  taskHandler: function(options){ //执行任务的回调，如果是异步操作的话，那么返回 Promise
    
  }
});
//执行任务，需要在 master 进程里调用
instance.doTask(options).then(data => {
  
}); 
```

### 方法

#### doTask(options)

执行任务，传入的参数会传到 taskHandler 中，返回 Promise。

#### stop()

结束任务，会销毁创建的子进程。