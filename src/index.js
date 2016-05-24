import os from 'os';
import cluster from 'cluster';
import {EventEmitter} from 'events';
import {defer} from 'stc-helper';

/**
 * status list
 */
const STATUS = {
  WAIT: 1,
  READY: 2,
  EXEC: 3
};

/**
 * type list
 */
const TYPE = {
  ID: '__id__',
  READY: '__ready__',
  TASK: '__task__',
  FINISH: '__finish__'
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
    taskHandler: null
  }){
    super();
    
    options.workers = options.workers || os.cpus().length;
    this.options = options;
    
    //for cluster
    this.workers = []; 
    this.deferred = [];
    
    //task hanler for worker
    this.taskHandler = options.taskHandler || noop;
    this.workerId = 0; //for worker
    
    this.start();
  }
  
  /**
   * start fork
   */
  start(){
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
    this.on(TYPE.READY, data => {
      let workerId = data.workerId;
      this.workers.some(item => {
        if(item.worker.id === workerId){
          item.status = STATUS.READY;
          this._runTask();
          return true;
        }
      });
    });
    
    //task finish, change worker status
    this.on(TYPE.FINISH, data => {   
      let {err, taskId, ret, workerId} = data;
      this.changeWorkerStatusById(workerId, STATUS.READY);
      let deferred = this.getDeferredByTaskId(taskId);
      this._runTask();
      if(!deferred){
        return;
      }
      if(err){
        deferred.reject(err);
      }else{
        deferred.resolve(ret);
      }
    });
  }
  
  /**
   * bind worker event
   */
  bindWorkerEvent(){
    //do task
    this.on(TYPE.TASK, data => {
      let {taskId, options} = data;
      let time = this.getTime(data.time, 'startTask');
      let promise = Promise.resolve(this.taskHandler(options));
      promise.then(data => {
        process.send({
          type: TYPE.FINISH, 
          ret: data, 
          taskId, 
          workerId: this.workerId,
          time: this.getTime(time, 'endTask')
        });
      }).catch(err => {
        process.send({
          type: TYPE.FINISH, 
          err, 
          taskId, 
          workerId: this.workerId,
          time: this.getTime(time, 'endTask')
        });
      });
    });
  }
  /**
   * change worker status by id
   */
  changeWorkerStatusById(workerId, status){
    this.workers.some(item => {
      if(item.worker.id === workerId){
        item.status = status;
        return true;
      }
    });
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
    let worker = null;
    this.workers.some(item => {
      if(item.status === STATUS.READY){
        worker = item.worker;
        //change worker status to exec
        if(changeStatus){
          item.status = STATUS.EXEC;
        }
        return true;
      }
    });
    return worker;
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
      time: this.getTime(toDoTask.time, 'sendTask')
    });
  }
  /**
   * do task
   */
  doTask(options = {}){
    if(!cluster.isMaster){
      throw new Error('doTask must be invoked in matser');
    }
    let deferred = defer();
    this.deferred.push({
      deferred, 
      options, 
      taskId: 0,
      time: this.getTime({}, 'pushTask')
    });
    this._runTask();
    return deferred.promise;
  }
  /**
   * get time
   */
  getTime(time = {}, name){
    time[name] = Date.now();
    return time;
  }
  /**
   * stop workers
   */
  stop(){
    this.workers.forEach(item => {
      item.worker.kill();
    });
  }
}