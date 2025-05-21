import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { AUTH } from './commands.js';

const GTEC_ROLE = '1374438933022249012';
const TUK_ROLE = '1374439011317321748';

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
  try {
    const { isValid, interaction } = await server.verifyDiscordRequest(
      request,
      env,
    );

    if (!isValid || !interaction) {
      return new Response('Bad request signature.', { status: 401 });
    }

    if (interaction.type === InteractionType.PING) {
      return new JsonResponse({
        type: InteractionResponseType.PONG,
      });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '통합 마인크래프트 서버 디스코드입니다.\n재학생, 졸업생 모두 가능합니다.',
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
              flags: 64,
            },
          });
        }
        default:
          return new JsonResponse(
            { error: 'Unknown Command' },
            { status: 400 },
          );
      }
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data.custom_id;

      let selectedUniversity = '';
      if (customId === 'initial_university_select') {
        selectedUniversity = interaction.data.values[0];
      } else if (customId.startsWith('show_verify_modal_')) {
        // '인증번호 입력' 버튼 클릭 처리
        const parts = customId.replace('show_verify_modal_', '').split(',');
        selectedUniversity = parts[0].replace(/_/g, ' ');
        const email = parts[1];

        // '인증번호 입력' 모달 띄우기
        return new JsonResponse({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: `verify_code_modal_${selectedUniversity.replace(/ /g, '_')},${email}`,
            title: '인증번호 입력',
            components: [
              {
                type: MessageComponentTypes.ActionRow,
                components: [
                  {
                    type: MessageComponentTypes.TextInput,
                    custom_id: 'verification_code_input',
                    label: '이메일로 전송된 인증번호를 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    placeholder: '인증번호 6자리',
                  },
                ],
              },
            ],
          },
        });
      }

      if (selectedUniversity && !customId.startsWith('show_verify_modal_')) {
        // 초기 대학교 선택 드롭다운 처리
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
                    placeholder: `예) 학번@${selectedUniversity === '경기과학기술대학교' ? 'office.gtec.ac.kr' : 'tukorea.ac.kr'}`,
                  },
                ],
              },
            ],
          },
        });
      }
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '알 수 없는 상호작용입니다.', flags: 64 },
      });
    }

    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      const modalCustomId = interaction.data.custom_id;

      if (modalCustomId.startsWith('email_modal_')) {
        let selectedUniversity = modalCustomId
          .replace('email_modal_', '')
          .replace(/_/g, ' ');

        let email = '';
        for (const actionRow of interaction.data.components) {
          for (const component of actionRow.components) {
            if (component.custom_id === 'email_input') {
              email = component.value;
            }
          }
        }

        let isValidEmailFormat = false;
        let expectedDomain = '';
        const actualSelectedUnivValue =
          selectedUniversity === '한국공학대학교'
            ? '한국산업기술대학교'
            : selectedUniversity;

        if (actualSelectedUnivValue === '경기과학기술대학교') {
          expectedDomain = 'office.gtec.ac.kr';
          isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@office\.gtec\.ac\.kr$/i.test(
            email,
          );
        } else if (actualSelectedUnivValue === '한국산업기술대학교') {
          expectedDomain = 'tukorea.ac.kr';
          isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@tukorea\.ac\.kr$/i.test(
            email,
          );
        }

        if (!isValidEmailFormat) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `이메일 형식이 맞지 않습니다. **${selectedUniversity}**의 올바른 이메일 형식(예: 학번@${expectedDomain})으로 다시 입력해주세요.`,
              flags: 64,
            },
          });
        }

        const univcertApiKey = env.UNIVCERT_API_KEY;
        if (!univcertApiKey) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '봇 설정 오류: 인증 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
              flags: 64,
            },
          });
        }

        const univcertPayload = {
          key: univcertApiKey,
          email: email,
          univName: selectedUniversity,
          univ_check: false,
        };

        try {
          const univcertResponse = await fetch(
            'https://univcert.com/api/v1/certify',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(univcertPayload),
            },
          );

          const univcertResult = await univcertResponse.json();

          if (univcertResponse.ok && univcertResult.success) {
            // 이메일 전송 성공: 인증번호 입력 버튼을 포함한 메시지 전송
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 메일이 전송되었습니다!**\n\n**${selectedUniversity}** 이메일로 인증 메일이 전송되었습니다. 메일을 확인하고 아래 **'인증번호 입력' 버튼**을 클릭해주세요!`,
                components: [
                  {
                    type: MessageComponentTypes.ActionRow,
                    components: [
                      {
                        type: MessageComponentTypes.Button,
                        custom_id: `show_verify_modal_${selectedUniversity.replace(/ /g, '_')},${email}`, // 버튼에 대학교, 이메일 정보 포함
                        style: 1, // ButtonStyle.Primary (파란색)
                        label: '인증번호 입력',
                      },
                    ],
                  },
                ],
                flags: 64,
              },
            });
          } else {
            let errorMessage = '인증 메일 전송에 실패했습니다.';
            if (univcertResult.message) {
              errorMessage += `\n오류: ${univcertResult.message}`;
            } else {
              errorMessage += `\n알 수 없는 API 응답 오류.`;
            }
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 메일 전송 실패!**\n\n${errorMessage}\n\n잠시 후 다시 시도하거나, 이메일 주소를 다시 확인해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `인증 서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. ${apiError}`,
              flags: 64,
            },
          });
        }
      } else if (modalCustomId.startsWith('verify_code_modal_')) {
        const parts = modalCustomId
          .replace('verify_code_modal_', '')
          .split(',');
        const selectedUniversity = parts[0].replace(/_/g, ' ');
        const email = parts[1];

        let verificationCode = '';
        for (const actionRow of interaction.data.components) {
          for (const component of actionRow.components) {
            if (component.custom_id === 'verification_code_input') {
              verificationCode = component.value;
            }
          }
        }

        const univcertApiKey = env.UNIVCERT_API_KEY;
        if (!univcertApiKey) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '봇 설정 오류: 인증 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
              flags: 64,
            },
          });
        }

        const verifyPayload = {
          key: univcertApiKey,
          email: email,
          univName: selectedUniversity,
          code: verificationCode,
        };

        try {
          const verifyResponse = await fetch(
            'https://univcert.com/api/v1/certifycode',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(verifyPayload),
            },
          );

          const verifyResult = await verifyResponse.json();

          if (verifyResponse.ok && verifyResult.success) {
            const discordBotToken = env.DISCORD_BOT_TOKEN;
            if (!discordBotToken) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content:
                    '봇 설정 오류: Discord 봇 토큰이 설정되지 않았습니다. 관리자에게 문의하세요.',
                  flags: 64,
                },
              });
            }

            let roleIdToAssign = '';
            let roleName = '';
            if (selectedUniversity === '경기과학기술대학교') {
              roleIdToAssign = GTEC_ROLE;
              roleName = '경기과기대';
            } else if (selectedUniversity === '한국공학대학교') {
              roleIdToAssign = TUK_ROLE;
              roleName = '한국공학대';
            }

            if (!roleIdToAssign) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `인증은 완료되었으나, **${selectedUniversity}** 역할 ID가 설정되지 않아 역할을 부여할 수 없습니다. 관리자에게 문의하세요.`,
                  flags: 64,
                },
              });
            }

            const guildId = interaction.guild_id;
            const userId = interaction.member.user.id;

            const addRoleResponse = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleIdToAssign}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bot ${discordBotToken}`,
                },
              },
            );

            if (addRoleResponse.ok) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `**인증 완료!**\n\n**${selectedUniversity}** 학생 역할(${roleName})이 성공적으로 부여되었습니다!`,
                  flags: 64,
                },
              });
            } else {
              const errorText = await addRoleResponse.text();
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `**역할 부여 실패!**\n\n인증은 완료되었으나, 역할 부여에 실패했습니다. 봇의 권한을 확인하거나 관리자에게 문의해주세요.\n(Discord API 오류: ${addRoleResponse.status} ${errorText.substring(0, 100)}...)`,
                  flags: 64,
                },
              });
            }
          } else {
            let errorMessage = '인증번호가 올바르지 않습니다.';
            if (verifyResult.message) {
              errorMessage += `\n오류: ${verifyResult.message}`;
            } else {
              errorMessage += `\n알 수 없는 API 응답 오류.`;
            }
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 실패!**\n\n${errorMessage}\n\n다시 확인하고 정확한 인증번호를 입력해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `인증 서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. ${apiError}`,
              flags: 64,
            },
          });
        }
      } else {
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '알 수 없는 모달 상호작용입니다.', flags: 64 },
        });
      }
    }

    return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
  } catch (error) {
    return new JsonResponse(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    );
  }
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

  const interaction = JSON.parse(body);

  return { interaction, isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
