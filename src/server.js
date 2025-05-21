import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { AUTH, RENAME } from './commands.js';

const GTEC_ROLE = '1374438933022249012';
const TUK_ROLE = '1374439011317321748';

const ALLOWED_CHANNEL_ID = '1374615611291729960';

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
          if (
            interaction.channel_id &&
            interaction.channel_id !== ALLOWED_CHANNEL_ID
          ) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `죄송합니다! 대학교 인증은 지정된 채널에서만 사용할 수 있습니다.`,
                flags: 64,
              },
            });
          }

          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '**대학교 인증을 시작합니다.**\n\n졸업생은 수동 인증을 해야합니다.\n방장에게 에타 프로필 캡처본과 학번 9자리를 보내주세요.',
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
        case RENAME.name.toLowerCase(): {
          const token = env.DISCORD_TOKEN;
          if (!token) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '봇 설정 오류: Discord 봇 토큰이 설정되지 않았습니다.\n관리자에게 문의하세요.',
                flags: 64,
              },
            });
          }

          let currentNickname =
            interaction.member.nick || interaction.member.user.username;
          let studentIdPrefix = '';
          let actualName = currentNickname;

          const studentIdMatch = currentNickname.match(/^\[(\d+)\]\s*(.*)$/);
          if (studentIdMatch) {
            studentIdPrefix = studentIdMatch[1];
            actualName = studentIdMatch[2];
          }

          return new JsonResponse({
            type: InteractionResponseType.MODAL,
            data: {
              custom_id: `rename_modal_${studentIdPrefix}`,
              title: '닉네임 변경 (학번 입력 X)',
              components: [
                {
                  type: MessageComponentTypes.ActionRow,
                  components: [
                    {
                      type: MessageComponentTypes.TextInput,
                      custom_id: 'new_nickname_input',
                      label: `변경할 이름을 입력해주세요.`,
                      style: TextInputStyle.Short,
                      required: true,
                      placeholder: actualName,
                      max_length: 32,
                    },
                  ],
                },
              ],
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
        const parts = customId.replace('show_verify_modal_', '').split(',');
        selectedUniversity = parts[0].replace(/_/g, ' ');
        const email = parts[1];
        const studentId = parts[2] ? decodeURIComponent(parts[2]) : '';
        const studentName = parts[3] ? decodeURIComponent(parts[3]) : '';

        return new JsonResponse({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: `verify_code_modal_${selectedUniversity.replace(/ /g, '_')},${email},${encodeURIComponent(studentId)},${encodeURIComponent(studentName)}`,
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
                    placeholder: '인증번호 4자리',
                  },
                ],
              },
            ],
          },
        });
      }

      if (selectedUniversity && !customId.startsWith('show_verify_modal_')) {
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
                    custom_id: 'student_id_input',
                    label: '학번 또는 메일 아이디를 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    placeholder: `예) 202512345`,
                  },
                ],
              },
              {
                type: MessageComponentTypes.ActionRow,
                components: [
                  {
                    type: MessageComponentTypes.TextInput,
                    custom_id: 'student_name_input',
                    label: '이름을 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    placeholder: `예) 홍길동`,
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

        let studentId = '';
        let studentName = '';
        for (const actionRow of interaction.data.components) {
          for (const component of actionRow.components) {
            if (component.custom_id === 'student_id_input') {
              studentId = component.value;
            } else if (component.custom_id === 'student_name_input') {
              studentName = component.value;
            }
          }
        }

        let actualEmail = '';
        let expectedDomain = '';
        const actualSelectedUnivValue =
          selectedUniversity === '한국공학대학교'
            ? '한국산업기술대학교'
            : selectedUniversity;

        if (actualSelectedUnivValue === '경기과학기술대학교') {
          expectedDomain = 'office.gtec.ac.kr';
          actualEmail = `${studentId}@${expectedDomain}`;
        } else if (actualSelectedUnivValue === '한국산업기술대학교') {
          expectedDomain = 'tukorea.ac.kr';
          actualEmail = `${studentId}@${expectedDomain}`;
        }

        if (studentId.length < 4) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `학번 형식이 올바르지 않습니다.\n${selectedUniversity}의 올바른 학번 또는 메일 아이디(예: 202512345)를 다시 입력해주세요.`,
              flags: 64,
            },
          });
        }

        const univcertEmail = actualEmail;

        const univcertApiKey = env.UNIVCERT_API_KEY;
        if (!univcertApiKey) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '봇 설정 오류: 인증 API 키가 설정되지 않았습니다.\n관리자에게 문의하세요.',
              flags: 64,
            },
          });
        }

        const univcertPayload = {
          key: univcertApiKey,
          email: univcertEmail,
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
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 메일이 전송되었습니다!**\n${selectedUniversity} 이메일(${univcertEmail})로 인증 메일이 전송되었습니다.\n메일을 확인하고 아래 버튼을 클릭해주세요!`,
                components: [
                  {
                    type: MessageComponentTypes.ActionRow,
                    components: [
                      {
                        type: MessageComponentTypes.Button,
                        custom_id: `show_verify_modal_${selectedUniversity.replace(/ /g, '_')},${encodeURIComponent(univcertEmail)},${encodeURIComponent(studentId)},${encodeURIComponent(studentName)}`,
                        style: 1,
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
                content: `**인증 메일 전송 실패!**\n${errorMessage}\n잠시 후 다시 시도하거나, 학번을 다시 확인해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `인증 서버와의 통신 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요. ${apiError}`,
              flags: 64,
            },
          });
        }
      } else if (modalCustomId.startsWith('verify_code_modal_')) {
        const parts = modalCustomId
          .replace('verify_code_modal_', '')
          .split(',');
        const selectedUniversity = parts[0].replace(/_/g, ' ');
        const email = decodeURIComponent(parts[1]);
        const studentId = parts[2] ? decodeURIComponent(parts[2]) : '';
        const studentName = parts[3] ? decodeURIComponent(parts[3]) : '';

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
                '봇 설정 오류: 인증 API 키가 설정되지 않았습니다.\n관리자에게 문의하세요.',
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
            const token = env.DISCORD_TOKEN;
            if (!token) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content:
                    '봇 설정 오류: Discord 봇 토큰이 설정되지 않았습니다.\n관리자에게 문의하세요.',
                  flags: 64,
                },
              });
            }

            let roleIdToAssign = '';
            if (selectedUniversity === '경기과학기술대학교') {
              roleIdToAssign = GTEC_ROLE;
            } else if (selectedUniversity === '한국공학대학교') {
              roleIdToAssign = TUK_ROLE;
            }

            if (!roleIdToAssign) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `인증은 완료되었으나, ${selectedUniversity} 역할 ID가 설정되지 않아 역할을 부여할 수 없습니다.\n관리자에게 문의하세요.`,
                  flags: 64,
                },
              });
            }

            const guildId = interaction.guild_id;
            const userId = interaction.member.user.id;
            const nickname = `[${studentId}] ${studentName}`;

            const changeNicknameResponse = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
              {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bot ${token}`,
                },
                method: 'PATCH',
                body: JSON.stringify({ nick: nickname }),
              },
            );

            if (!changeNicknameResponse.ok) {
              console.error(
                'Failed to change nickname:',
                await changeNicknameResponse.text(),
              );
            }

            const addRoleResponse = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleIdToAssign}`,
              {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bot ${token}`,
                },
                method: 'PUT',
              },
            );

            if (addRoleResponse.ok) {
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `**${selectedUniversity} 학생 인증 완료!**`,
                  flags: 64,
                },
              });
            } else {
              const errorText = await addRoleResponse.text();
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `**역할 부여 실패!**\n인증은 완료되었으나, 역할 부여에 실패했습니다.\n봇의 권한을 확인하거나 관리자에게 문의해주세요.\n(Discord API 오류: ${addRoleResponse.status} ${errorText.substring(0, 100)}...)`,
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
                content: `**인증 실패!**\n${errorMessage}\n다시 확인하고 정확한 인증번호를 입력해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `인증 서버와의 통신 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요. ${apiError}`,
              flags: 64,
            },
          });
        }
      } else if (modalCustomId.startsWith('rename_modal_')) {
        const studentIdPrefix = modalCustomId.replace('rename_modal_', '');
        let newName = '';
        for (const actionRow of interaction.data.components) {
          for (const component of actionRow.components) {
            if (component.custom_id === 'new_nickname_input') {
              newName = component.value;
            }
          }
        }

        const token = env.DISCORD_TOKEN;
        if (!token) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '봇 설정 오류: Discord 봇 토큰이 설정되지 않았습니다.\n관리자에게 문의하세요.',
              flags: 64,
            },
          });
        }

        const guildId = interaction.guild_id;
        const userId = interaction.member.user.id;

        const finalNickname = studentIdPrefix
          ? `[${studentIdPrefix}] ${newName}`
          : newName;

        try {
          const changeNicknameResponse = await fetch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bot ${token}`,
              },
              method: 'PATCH',
              body: JSON.stringify({ nick: finalNickname }),
            },
          );

          if (changeNicknameResponse.ok) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `닉네임이 성공적으로 **${newName}** (으)로 변경되었습니다.`,
                flags: 64,
              },
            });
          } else {
            const errorText = await changeNicknameResponse.text();
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `닉네임 변경에 실패했습니다.\n봇의 권한을 확인하거나, 유효한 닉네임인지 확인해주세요.\n(Discord API 오류: ${changeNicknameResponse.status} ${errorText.substring(0, 100)}...)`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Discord API 통신 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요. ${apiError}`,
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
