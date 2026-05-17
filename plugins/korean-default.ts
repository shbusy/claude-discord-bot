import type { Plugin } from '../src/plugins/api.js';

/**
 * 모든 프롬프트 앞에 한국어 응답 지시를 삽입하는 예제 플러그인.
 */
const plugin: Plugin = {
  name: 'korean-default',
  version: '0.1.0',
  async onLoad(ctx) {
    ctx.log.info('korean-default 플러그인 로드');
  },
  hooks: {
    async onUserMessage(_msg, _ctx) {
      // 향후: 메시지 전처리에서 "항상 한국어로 답변" 시스템 프롬프트 삽입
      return { handled: false };
    },
  },
};

export default plugin;
