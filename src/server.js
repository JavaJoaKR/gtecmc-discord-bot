/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
  // 모달 및 컴포넌트 타입을 사용하기 위해 추가합니다.
  MessageComponentTypes,
  TextInputStyle,
} from 'discord-interactions';
import { AUTH } from './commands.js'; // commands.js에 AUTH가 정의되어 있다고 가정합니다.

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

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/', async (request, env) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  // --- 슬래시 명령어 처리 (`/인증`) ---
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    switch (interaction.data.name.toLowerCase()) {
      case AUTH.name.toLowerCase(): {
        // `/인증` 명령어를 받았을 때 모달을 반환합니다.
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
                      { label: '한국공학대학교', value: '한국산업기술대학교' },
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
        console.error('Unknown Command');
        return new JsonResponse({ error: 'Unknown Command' }, { status: 400 });
    }
  }

  // --- 모달 제출 처리 (사용자가 모달에서 '확인' 버튼을 눌렀을 때) ---
  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    // 제출된 모달이 우리가 만든 'authentication_modal'인지 확인합니다.
    if (interaction.data.custom_id === 'authentication_modal') {
      let selectedUniversity = '미선택';
      let email = '미입력';

      // 모달에서 제출된 컴포넌트의 값을 추출합니다.
      // 모달의 data.components 배열 안에 ActionRow들이 있고,
      // 각 ActionRow 안에 다시 components 배열로 실제 컴포넌트들이 있습니다.
      for (const actionRow of interaction.data.components) {
        for (const component of actionRow.components) {
          if (component.custom_id === 'university_select') {
            selectedUniversity = component.value;
          } else if (component.custom_id === 'email_input') {
            email = component.value;
          }
        }
      }

      // 추출된 정보를 Discord 채팅으로 응답합니다.
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, // 채널에 메시지를 보냅니다.
        data: {
          content: `**인증 정보 확인:**\n- **선택된 대학교:** ${selectedUniversity}\n- **입력된 이메일:** ${email}`,
          flags: 0, // 0은 모두에게 공개, 64는 사용자에게만 보이는 임시 메시지 (ephemeral)
        },
      });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
