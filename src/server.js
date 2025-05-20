/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
  // 기존 임포트에서 MessageComponentTypes, TextInputStyle 제거 (아래에서 상수로 직접 정의)
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

const ButtonStyle = {
  // 버튼 스타일 상수 추가
  Primary: 1, // 파란색
  Secondary: 2, // 회색
  Success: 3, // 초록색
  Danger: 4, // 빨간색
  Link: 5, // 링크 (URL 필요)
};

const TextInputStyle = {
  Short: 1, // 한 줄 텍스트 입력
  Paragraph: 2, // 여러 줄 텍스트 입력
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
  console.log('Interaction received:', new Date().toISOString());

  try {
    // Worker 내부에서 발생하는 모든 예외를 잡기 위한 try-catch 블록
    const { isValid, interaction } = await server.verifyDiscordRequest(
      request,
      env,
    );

    if (!isValid || !interaction) {
      console.log('Invalid request signature or no interaction.', {
        isValid,
        interaction,
      });
      return new Response('Bad request signature.', { status: 401 });
    }
    console.log('Request valid. Interaction type:', interaction.type);
    console.log('Interaction data:', JSON.stringify(interaction.data, null, 2));

    if (interaction.type === InteractionType.PING) {
      console.log('Responding with PONG.');
      return new JsonResponse({
        type: InteractionResponseType.PONG,
      });
    }

    // --- 1. 슬래시 명령어 처리 (`/인증`): 관리자만 사용, 버튼 포함 메시지 전송 ---
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log('Handling APPLICATION_COMMAND:', interaction.data.name);
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          console.log(
            'Admin user called /인증. Sending university selection message with buttons.',
          );
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, // 채널에 메시지 전송
            data: {
              content: '인증할 대학교를 선택하세요.',
              components: [
                // 메시지에 버튼 추가
                {
                  type: MessageComponentTypes.ActionRow,
                  components: [
                    {
                      type: MessageComponentTypes.Button,
                      custom_id: 'select_university_gtec', // 경기과기대 버튼 ID
                      style: ButtonStyle.Primary, // 파란색 버튼
                      label: '경기과학기술대학교',
                    },
                    {
                      type: MessageComponentTypes.Button,
                      custom_id: 'select_university_tuk', // 한국공학대 버튼 ID
                      style: ButtonStyle.Primary, // 파란색 버튼
                      label: '한국공학대학교',
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

    // --- 2. 버튼 클릭 상호작용 처리 (`MESSAGE_COMPONENT`): 이메일 입력 모달 표시 ---
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      console.log(
        'Handling MESSAGE_COMPONENT. Custom ID:',
        interaction.data.custom_id,
      );
      const customId = interaction.data.custom_id;

      let selectedUniversity = '';
      if (customId === 'select_university_gtec') {
        selectedUniversity = '경기과학기술대학교';
      } else if (customId === 'select_university_tuk') {
        selectedUniversity = '한국산업기술대학교';
      }

      if (selectedUniversity) {
        console.log(
          `User selected ${selectedUniversity}. Preparing to send email modal.`,
        );
        return new JsonResponse({
          type: InteractionResponseType.MODAL, // 모달 표시
          data: {
            // 모달 custom_id에 선택된 대학교 정보를 포함하여 나중에 추출할 수 있도록 합니다.
            custom_id: `email_modal_${selectedUniversity.replace(/ /g, '_')}`, // 예: email_modal_경기과학기술대학교
            title: `${selectedUniversity} 이메일 인증`,
            components: [
              {
                type: MessageComponentTypes.ActionRow,
                components: [
                  {
                    type: MessageComponentTypes.TextInput,
                    custom_id: 'email_input', // 이메일 입력 필드 ID
                    label: '학교 이메일을 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    placeholder: `예: yourname@${selectedUniversity === '경기과학기술대학교' ? 'gtec.ac.kr' : 'kpu.ac.kr'}`,
                  },
                ],
              },
            ],
          },
        });
      }
      console.log('Unknown button custom_id:', customId);
      // 알 수 없는 버튼 클릭 시, 사용자에게만 보이는 임시 메시지로 응답 (타임아웃 방지)
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '알 수 없는 버튼 상호작용입니다.', flags: 64 }, // flags: 64는 ephemeral (사용자만 볼 수 있음)
      });
    }

    // --- 3. 모달 제출 처리 (`MODAL_SUBMIT`): 선택된 대학교와 이메일 출력 ---
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      console.log(
        'Handling MODAL_SUBMIT. Custom ID:',
        interaction.data.custom_id,
      );
      const modalCustomId = interaction.data.custom_id;

      let selectedUniversity = '미선택';
      // 모달 custom_id에서 대학교 정보 추출
      if (modalCustomId.startsWith('email_modal_')) {
        selectedUniversity = modalCustomId
          .replace('email_modal_', '')
          .replace(/_/g, ' '); // '_'를 공백으로 되돌림
      }

      let email = '미입력';
      // 모달 컴포넌트에서 이메일 값 추출
      for (const actionRow of interaction.data.components) {
        for (const component of actionRow.components) {
          if (component.custom_id === 'email_input') {
            email = component.value;
          }
        }
      }

      console.log(
        `Modal submitted: University - ${selectedUniversity}, Email - ${email}. Responding to channel.`,
      );
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `**인증 정보 확인:**\n- **선택된 대학교:** ${selectedUniversity}\n- **입력된 이메일:** ${email}`,
          flags: 0, // 모두에게 보이는 메시지
        },
      });
    }

    // 예상치 못한 상호작용 타입인 경우
    console.error('Unknown Interaction Type:', interaction.type);
    return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
  } catch (error) {
    // 최상위 try-catch 블록: 예상치 못한 오류를 잡고 로그 출력
    console.error('Unhandled error in router.post:', error);
    return new JsonResponse(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    );
  }
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  console.log('Entering verifyDiscordRequest.');
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();

  console.log('Body parsed. Attempting signature verification.');
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));

  console.log('Signature verification complete. isValid:', isValidRequest);

  if (!isValidRequest) {
    return { isValid: false };
  }

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
