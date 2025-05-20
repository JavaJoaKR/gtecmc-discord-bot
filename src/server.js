/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { AUTH } from './commands.js';

// Discord API 컴포넌트 타입 및 스타일 상수
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

// ButtonStyle은 현재 사용하지 않지만, 필요할 경우를 위해 유지합니다.
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

    // --- 1. 슬래시 명령어 처리 (`/인증`): 관리자만 사용, 지연 응답 및 드롭다운 메시지 전송 ---
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log('Handling APPLICATION_COMMAND:', interaction.data.name);
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          console.log(
            'Admin user called /인증. Deferring response and scheduling university selection message.',
          );

          // 1단계: 디스코드에 "생각 중..." 응답을 즉시 보냅니다.
          // 이렇게 하면 "누구누구가 명령어를 사용했습니다" 메시지가 표시되지 않습니다.
          const initialResponse = new JsonResponse({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          });

          // 2단계: 실제 메시지를 웹훅을 통해 비동기적으로 보냅니다.
          // request.context.waitUntil을 사용하여 Worker가 응답을 반환한 후에도
          // 이 비동기 작업이 완료되도록 보장합니다.
          request.context.waitUntil(
            (async () => {
              const messageContent = {
                content: '통합 마인크래프트 서버 디스코드입니다.',
                components: [
                  {
                    type: MessageComponentTypes.ActionRow,
                    components: [
                      {
                        type: MessageComponentTypes.StringSelect,
                        custom_id: 'initial_university_select',
                        placeholder: '인증할 대학교를 선택해주세요.',
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
                ],
              };

              // interaction.token을 사용하여 원래 상호작용에 대한 후속 메시지를 보냅니다.
              const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`;

              try {
                const webhookResponse = await fetch(webhookUrl, {
                  method: 'POST', // 새 후속 메시지를 보내기 위해 POST 사용
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(messageContent),
                });

                if (!webhookResponse.ok) {
                  console.error(
                    'Failed to send follow-up message:',
                    webhookResponse.status,
                    await webhookResponse.text(),
                  );
                } else {
                  console.log('Follow-up message sent successfully.');
                }
              } catch (fetchError) {
                console.error('Error sending follow-up message:', fetchError);
              }
            })(),
          );

          // 첫 번째 응답(지연 응답)을 즉시 반환하여 디스코드의 타임아웃을 방지합니다.
          return initialResponse;
        }
        default:
          console.error('Unknown Command:', interaction.data.name);
          return new JsonResponse(
            { error: 'Unknown Command' },
            { status: 400 },
          );
      }
    }

    // --- 2. 드롭다운 선택 상호작용 처리 (`MESSAGE_COMPONENT`): 이메일 입력 모달 표시 ---
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      console.log(
        'Handling MESSAGE_COMPONENT (Dropdown Select). Custom ID:',
        interaction.data.custom_id,
      );
      const customId = interaction.data.customId; // customId는 interaction.data.custom_id에서 직접 가져옵니다.

      let selectedUniversity = '';
      if (customId === 'initial_university_select') {
        selectedUniversity = interaction.data.values[0];
      }

      if (selectedUniversity) {
        console.log(
          `User selected ${selectedUniversity} from dropdown. Preparing to send email modal.`,
        );
        return new JsonResponse({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: `email_modal_${selectedUniversity.replace(/ /g, '_')}`,
            title: `${selectedUniversity} 이메일 인증`,
            components: [
              {
                type: MessageComponentTypes.ActionRow,
                components: [
                  {
                    type: MessageComponentTypes.TextInput,
                    custom_id: 'email_input',
                    label: '학교 이메일을 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    placeholder: `예: yourname@${selectedUniversity === '경기과학기술대학교' ? 'office.gtec.ac.kr' : 'tukorea.ac.kr'}`,
                  },
                ],
              },
            ],
          },
        });
      }
      console.log('Unknown message component custom_id:', customId);
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '알 수 없는 상호작용입니다.', flags: 64 },
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
      if (modalCustomId.startsWith('email_modal_')) {
        selectedUniversity = modalCustomId
          .replace('email_modal_', '')
          .replace(/_/g, ' ');
      }

      let email = '미입력';
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
          flags: 0,
        },
      });
    }

    console.error('Unknown Interaction Type:', interaction.type);
    return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
  } catch (error) {
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
