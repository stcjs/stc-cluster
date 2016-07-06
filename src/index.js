import os from 'os';
import cluster from 'cluster';
import {EventEmitter} from 'events';
import {defer} from 'stc-helper';

/**
 * status list
 */
const STATUS = {
  WAIT: 1,
  READY: 2
};

/**
 * type list
 */
const TYPE = {
  ID: '__id__',
  READY: '__ready__',
  TASK: '__task__',
  FINISH: '__finish__',
  INVOKE: '__invoke__'
};

/**
 * task id
 */
let TASK_ID = 1;

/**
 * empty function
 */
const noop = () => {};

/**
 * constructor class
 */
export default class Cluster extends EventEmitter {
  /**
   * constructor
   */
  constructor(options = {
    workers: 0,
    workerHandle: null,
    masterHandle: null,
    logger: null,
    maxWorkerTask: 4
  }){
    super();
    
    options.workers = options.workers || os.cpus().length;
    this.options = options;
    this.logger = options.logger || noop;
    this.maxWorkerTask = this.options.maxWorkerTask || 4;
    
    //for cluster
    this.workers = []; 
    this.masterHandle = options.masterHandle || noop;
    
    //task handler for worker
    this.workerHandle = options.workerHandle || noop;
    this.workerId = 0; //for worker
    
    this.deferred = []; 
    
    this._started = false;
  }
  
  /**
   * start fork
   */
  start(){
    if(this._started){
      return;
    }
    this._started = true;
    if(cluster.isMaster){
      this.bindMasterEvent();
      for(let i = 0; i < this.options.workers; i++){
        let worker = cluster.fork();
        this.workers.push({
          worker: worker,
          status: STATUS.WAIT
        });
        worker.send({type: TYPE.ID, workerId: worker.id});
        worker.on('message', params => {
          this.emit(params.type, params);
        });
      }
    }else{
      this.bindWorkerEvent();
      process.on('message', params => {
        if(params.type === TYPE.ID){
          this.workerId = params.workerId;
          // add workerId for process
          process.workerId = this.workerId; 
          process.send({type: TYPE.READY, workerId: this.workerId});
          return;
        }
        this.emit(params.type, params);
      });
      return;
    }
  }
  
  /**
   * bind master event
   */
  bindMasterEvent(){
    //worker is ready
    let startTime = Date.now();
    this.on(TYPE.READY, data => {
      let workerId = data.workerId;
      this.workers.some(item => {
        if(item.worker.id === workerId){
          item.status = STATUS.READY;
          let index = 0;
          while(index++ < this.maxWorkerTask){
            this._runTask();
          }
          return true;
        }
      });
      this.logger(`workerReady: time=${Date.now() - startTime}ms, workerId=${workerId}`);
    });
    
    //task finish, change worker status
    this.on(TYPE.FINISH, data => {   
      let {err, taskId, ret, workerId} = data;
      let time = this.getTime(data.time, 'response');
      this.logger('master: ' + this.parseTime(time));
      this.changeWorkerStatus(workerId, -1);
      let deferred = this.getDeferredByTaskId(taskId);
      this._runTask();
      if(!deferred){
        return;
      }
      if(err){
        err = new Error(err);
        err.stack = data.stack;
        deferred.reject(err);
      }else{
        deferred.resolve(ret);
      }
    });
    
    //invoked from worker;
    this.on(TYPE.INVOKE, data => {
      let {taskId, options, workerId} = data;
      let time = this.getTime(data.time, 'request');
      let promise = Promise.resolve(this.masterHandle(options));
      let worker = this.getWorkerById(workerId);
      promise.then(data => {
        worker.send({
          type: TYPE.INVOKE,
          ret: data,
          taskId,
          time: this.getTime(time, 'exec')
        });
      }).catch(err => {
        worker.send({
          type: TYPE.INVOKE,
          err: err.toString(),
          stack: err.stack,
          taskId,
          time: this.getTime(time, 'exec')
        });
      });
    });
  }
  
  /**
   * bind worker event
   */
  bindWorkerEvent(){
    //do task
    this.on(TYPE.TASK, data => {
      let {taskId, options} = data;
      let time = this.getTime(data.time, 'request');
      let promise = Promise.resolve(this.workerHandle(options));
      promise.then(data => {
        process.send({
          type: TYPE.FINISH, 
          ret: data, 
          taskId, 
          workerId: this.workerId,
          time: this.getTime(time, 'exec')
        });
      }).catch(err => {
        process.send({
          type: TYPE.FINISH, 
          err: err.toString(),
          stack: err.stack,
          taskId, 
          workerId: this.workerId,
          time: this.getTime(time, 'exec')
        });
      });
    });
    
    //get data from master
    this.on(TYPE.INVOKE, data => {
      let {err, ret, taskId} = data;
      let time = this.getTime(data.time, 'response');
      this.logger('worker: ' + this.parseTime(time));
      let deferred = this.getDeferredByTaskId(taskId);
      if(!deferred){
        return;
      }
      if(err){
        err = new Error(err);
        err.stack = data.stack;
        deferred.reject(err);
      }else{
        deferred.resolve(ret);
      }
    });
  }
  /**
   * get time
   */
  getTime(time = {}, name){
    time[name] = Date.now();
    return time;
  }
  /**
   * parse time to string
   */
  parseTime(time = {}){
    let arr = Object.keys(time).map(name => {
      return {name, value: time[name]};
    }).sort((a, b) => {
      return a.time < b.time ? 1 : -1;
    });
    return arr.map((item, idx) => {
      if(idx === 0){
        return '';
      }
      return `${item.name}=${item.value - arr[idx - 1].value}ms`;
    }).slice(1).join(', ');
  }
  /**
   * change worker status by id
   */
  changeWorkerStatus(workerId, status){
    this.workers.some(item => {
      if(item.worker.id === workerId){
        item.status += status;
        return true;
      }
    });
  }
  /**
   * get worker by id
   */
  getWorkerById(workerId){
    let worker = null;
    this.workers.some(item => {
      if(item.worker.id === workerId){
        worker = item.worker;
        return true;
      }
    });
    return worker;
  }
  /**
   * get deferred by task id
   */
  getDeferredByTaskId(taskId, remove = true){
    let deferred = null;
    this.deferred.some((item, idx) => {
      if(item.taskId === taskId){
        deferred = item.deferred;
        if(remove){
          this.deferred.splice(idx, 1);
        }
        return true;
      }
    });
    return deferred;
  }
  /**
   * get idle worker
   */
  getIdleWorker(changeStatus = true){
    let selectItem = null;
    this.workers.forEach(item => {
      if(item.status === STATUS.WAIT){
        return;
      }
      if(item.status >= (this.maxWorkerTask + 2)){
        return;
      }
      if(!selectItem || item.status < selectItem.status){
        selectItem = item;
      }
    });
    if(selectItem){
      if(changeStatus){
        selectItem.status++;
      }
      return selectItem.worker;
    }
  }
  /**
   * get to do task
   */
  getToDoTask(){
    if(this.deferred.length === 0){
      return;
    }
    let deferred = null;
    this.deferred.some(item => {
      if(!item.taskId){
        item.taskId = TASK_ID++;
        deferred = item;
        return true;
      }
    });
    return deferred;
  }
  /**
   * run task
   */
  _runTask(){
    let toDoTask = this.getToDoTask();
    if(!toDoTask){
      return;
    }

    let idleWorker = this.getIdleWorker();
    if(!idleWorker){
      toDoTask.taskId = 0;
      return;
    }

    idleWorker.send({
      type: TYPE.TASK, 
      taskId: toDoTask.taskId, 
      options: toDoTask.options,
      time: this.getTime(toDoTask.time, 'wait')
    });
  }
  /**
   * do task, invoked in master
   */
  masterInvoke(options = {}){
    if(!cluster.isMaster){
      throw new Error('masterInvoke() must be invoked in matser');
    }
    this.start();
    
    let deferred = defer();
    this.deferred.push({
      deferred, 
      options, 
      taskId: 0,
      time: this.getTime({}, 'init')
    });
    this._runTask();
    return deferred.promise;
  }
  
  /**
   * get something from master, invoke in worker
   */
  workerInvoke(options = {
    method: '',
    args: ''
  }){
    if(cluster.isMaster){
      throw new Error('workerInvoke() must be invoked in worker');
    }
    this.start();
    
    let deferred = defer();
    let taskId = TASK_ID++;
    let time = this.getTime({}, 'init');
    time = this.getTime(time, 'wait');
    this.deferred.push({
      deferred,
      taskId,
      time
    });
    process.send({
      type: TYPE.INVOKE,
      taskId,
      options,
      time,
      workerId: this.workerId
    });
    return deferred.promise;
  }
  /**
   * stop workers
   */
  stop(){
    if(!cluster.isMaster){
      throw new Error('stop() must be invoked in master');
    }
    this.workers.forEach(item => {
      item.worker.kill();
    });
  }
}