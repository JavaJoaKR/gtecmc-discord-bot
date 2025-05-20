/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
  // 기존 임포트에서 MessageComponentTypes와 TextInputStyle 제거 (아래에서 상수로 직접 정의)
} from 'discord-interactions';
import { AUTH } from './commands.js';

// Discord API 컴포넌트 타입 및 스타일 상수
// discord-interactions 라이브러리에서 직접 export되지 않을 수 있으므로 명시적으로 정의합니다.
const MessageComponentTypes = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
};

const TextInputStyle = {
  Short: 1,
  Paragraph: 2,
};

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

const router = AutoRouter();

router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

router.post('/', async (request, env) => {
  // --- 1. 요청 시작 시점 로그 ---
  console.log('Interaction received:', new Date().toISOString());

  try {
    // Worker 내부에서 발생하는 모든 예외를 잡기 위한 try-catch 블록 추가
    const { isValid, interaction } = await server.verifyDiscordRequest(
      request,
      env,
    );

    // --- 2. 서명 검증 결과 로그 ---
    if (!isValid || !interaction) {
      console.log('Invalid request signature or no interaction.', {
        isValid,
        interaction,
      });
      return new Response('Bad request signature.', { status: 401 });
    }
    console.log('Request valid. Interaction type:', interaction.type);
    console.log('Interaction data:', JSON.stringify(interaction.data, null, 2)); // 디버깅을 위해 interaction.data 출력

    if (interaction.type === InteractionType.PING) {
      console.log('Responding with PONG.');
      return new JsonResponse({
        type: InteractionResponseType.PONG,
      });
    }

    // --- 슬래시 명령어 처리 (`/인증`) ---
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log('Handling APPLICATION_COMMAND:', interaction.data.name);
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          // --- 3. /인증 명령어 처리 직전 로그 ---
          console.log('Preparing to send modal for /인증 command.');
          return new JsonResponse({
            type: InteractionResponseType.MODAL, // 모달을 표시하는 응답 타입
            data: {
              custom_id: 'authentication_modal', // 이 모달의 고유 ID (모달 제출 시 사용)
              title: '대학교 인증',
              components: [
                {
                  type: MessageComponentTypes.ActionRow, // 컴포넌트를 담는 액션 로우
                  components: [
                    {
                      type: MessageComponentTypes.StringSelect, // 대학교 선택 드롭다운
                      custom_id: 'university_select', // 이 컴포넌트의 고유 ID
                      placeholder: '대학교를 선택해주세요.',
                      options: [
                        {
                          label: '경기과학기술대학교',
                          value: '경기과학기술대학교',
                        },
                        {
                          label: '한국공학대학교',
                          value: '한국산업기술대학교',
                        },
                      ],
                    },
                  ],
                },
                {
                  type: MessageComponentTypes.ActionRow, // 이메일 입력을 위한 또 다른 액션 로우
                  components: [
                    {
                      type: MessageComponentTypes.TextInput, // 이메일 입력 필드
                      custom_id: 'email_input', // 이 컴포넌트의 고유 ID
                      label: '학교 이메일을 입력해주세요.',
                      style: TextInputStyle.Short, // 한 줄 텍스트 입력 스타일
                      required: true, // 필수 입력 필드
                      placeholder:
                        '예: yourname@gtec.ac.kr 또는 yourname@kpu.ac.kr',
                    },
                  ],
                },
              ],
            },
          });
        }
        default:
          console.error('Unknown Command:', interaction.data.name);
          return new JsonResponse(
            { error: 'Unknown Command' },
            { status: 400 },
          );
      }
    }

    // --- 모달 제출 처리 (사용자가 모달에서 '확인' 버튼을 눌렀을 때) ---
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      console.log(
        'Handling MODAL_SUBMIT. Custom ID:',
        interaction.data.custom_id,
      );
      // 제출된 모달이 우리가 만든 'authentication_modal'인지 확인합니다.
      if (interaction.data.custom_id === 'authentication_modal') {
        let selectedUniversity = '미선택';
        let email = '미입력';

        // 모달에서 제출된 컴포넌트의 값을 추출합니다.
        for (const actionRow of interaction.data.components) {
          for (const component of actionRow.components) {
            if (component.custom_id === 'university_select') {
              selectedUniversity = component.value;
            } else if (component.custom_id === 'email_input') {
              email = component.value;
            }
          }
        }
        // --- 4. 모달 데이터 추출 후 응답 직전 로그 ---
        console.log(
          `Modal submitted: University - ${selectedUniversity}, Email - ${email}. Responding to channel.`,
        );
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, // 채널에 메시지를 보냅니다.
          data: {
            content: `**인증 정보 확인:**\n- **선택된 대학교:** ${selectedUniversity}\n- **입력된 이메일:** ${email}`,
            flags: 0, // 0은 모두에게 공개, 64는 사용자에게만 보이는 임시 메시지 (ephemeral)
          },
        });
      }
      console.log('Unknown modal custom_id:', interaction.data.custom_id);
    }

    // 예상치 못한 상호작용 타입인 경우
    console.error('Unknown Interaction Type:', interaction.type);
    return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
  } catch (error) {
    // --- 최상위 try-catch 블록: 예상치 못한 오류를 잡음 ---
    console.error('Unhandled error in router.post:', error);
    // Cloudflare Worker 로그에 오류가 명확히 나타나도록 500 응답 반환
    return new JsonResponse(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    );
  }
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  // --- 5. 서명 검증 함수 진입 로그 ---
  console.log('Entering verifyDiscordRequest.');
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text(); // 이 부분이 느릴 수 있음

  // --- 6. 바디 파싱 후 서명 검증 직전 로그 ---
  console.log('Body parsed. Attempting signature verification.');
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));

  // --- 7. 서명 검증 완료 로그 ---
  console.log('Signature verification complete. isValid:', isValidRequest);

  if (!isValidRequest) {
    return { isValid: false };
  }

  // 디버깅을 위해 파싱된 상호작용 객체도 로그에 출력
  const interaction = JSON.parse(body);
  console.log(
    'Parsed interaction object:',
    JSON.stringify(interaction, null, 2),
  );

  return { interaction, isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
