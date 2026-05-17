import { runDoctor } from './doctor.js';
import {
  PRIMARY_BROWSER_CHANNEL_NAME,
  PRIMARY_SESSIONS_CATEGORY_NAME,
  PRIMARY_USAGE_CHANNEL_NAME,
} from './bot/channelNames.js';

export const MANUAL_E2E_CHECKLIST = [
  'Discord Developer Portal에서 MESSAGE CONTENT INTENT가 켜져 있는지 확인',
  'npm run register 실행',
  'npm run run:bot 실행',
  `Discord에서 /cdb init 또는 /a4d init 실행 후 #${PRIMARY_BROWSER_CHANNEL_NAME}, #${PRIMARY_USAGE_CHANNEL_NAME}, ${PRIMARY_SESSIONS_CATEGORY_NAME} 카테고리 확인`,
  '/cdb browse 또는 /a4d browse에서 폴더 탐색, 폴더 생성 모달, 모델 버튼, permission mode 확인',
  '생성된 세션 채널에서 봇 멘션 후 text/thinking streaming 확인',
  '도구 호출 스레드와 도구 결과 게시 확인',
  '위험 도구 permission button 승인/거부 확인',
  'Discord 첨부 파일이 Claude에게 로컬 경로로 전달되는지 확인',
  'Claude Write 결과 파일이 도구 스레드에 첨부되는지 확인',
  `응답 완료 멘션과 #${PRIMARY_USAGE_CHANNEL_NAME} 게시 확인`,
  '봇 재시작 후 /cdb status 또는 /cdb resume으로 topic restore 확인',
  '/cdb close가 세션 중단 후 채널을 삭제하는지 확인',
];

export async function runManualE2EChecklist(envPath?: string): Promise<number> {
  const doctorCode = await runDoctor(envPath);
  if (doctorCode !== 0) {
    process.stdout.write('\nDoctor failed. Fix the checks above before running Discord e2e.\n');
    return doctorCode;
  }

  process.stdout.write('\nManual Discord e2e checklist:\n');
  MANUAL_E2E_CHECKLIST.forEach((item, index) => {
    process.stdout.write(`${index + 1}. ${item}\n`);
  });
  return 0;
}
