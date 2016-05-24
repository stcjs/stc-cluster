# stc-cluster

使用 cluster 来调用任务，可以利用多核 CPU 来提升 CPU 密集型任务。

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
instance.doTask(options); //执行任务，需要在 master 进程里调用
```
