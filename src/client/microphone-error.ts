export class MicrophoneAccessError extends Error {
  constructor() {
    super('麦克风请求未获准。可能是系统或浏览器权限，也可能是桌面 App 的录音权限声明缺失；这不代表你点过拒绝。')
    this.name = 'MicrophoneAccessError'
  }
}
