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

const GTEC_ROLE = 1374438933022249012
const TUK_ROLE = 1374439011317321748

// Discord API 컴포넌트 타입 및 스타일 상수
const MessageComponentTypes = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3, // StringSelect는 3번 타입입니다.
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
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

    // --- 1. 슬래시 명령어 처리 (`/인증`): 관리자만 사용, 드롭다운 포함 메시지 전송 ---
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log('Handling APPLICATION_COMMAND:', interaction.data.name);
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          console.log(
            'User called /인증. Sending university selection message with dropdown.',
          );
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, // 채널에 메시지 전송
            data: {
              content:
                '대학교 인증을 시작합니다.\n재학생, 졸업생 모두 가능합니다.',
              components: [
                // 메시지에 드롭다운 추가
                {
                  type: MessageComponentTypes.ActionRow,
                  components: [
                    {
                      type: MessageComponentTypes.StringSelect, // 버튼 대신 StringSelect 사용
                      custom_id: 'initial_university_select', // 드롭다운의 고유 ID
                      placeholder: '대학교를 선택해주세요.',
                      options: [
                        // 드롭다운에 표시될 옵션들
                        {
                          label: '경기과학기술대학교',
                          value: '경기과학기술대학교',
                        },
                        {
                          // '한국산업기술대학교'를 '한국공학대학교'로 변경하여 일관성 유지
                          label: '한국공학대학교',
                          value: '한국산업기술대학교',
                        },
                      ],
                    },
                  ],
                },
              ],
              flags: 64, // <-- 메시지를 본인에게만 보이도록 설정
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

    // --- 2. 드롭다운 선택 상호작용 처리 (`MESSAGE_COMPONENT`): 이메일 입력 모달 표시 ---
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      console.log(
        'Handling MESSAGE_COMPONENT (Dropdown Select). Custom ID:',
        interaction.data.custom_id,
      );
      const customId = interaction.data.custom_id;

      let selectedUniversity = '';
      // 'initial_university_select' 드롭다운에서 선택된 경우
      if (customId === 'initial_university_select') {
        // 드롭다운의 선택된 값은 interaction.data.values 배열에 있습니다.
        selectedUniversity = interaction.data.values[0]; // 첫 번째 (단일 선택) 값을 가져옵니다.
      }

      if (selectedUniversity) {
        console.log(
          `User selected ${selectedUniversity} from dropdown. Preparing to send email modal.`,
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
                    // 이메일 플레이스홀더를 요청에 따라 업데이트
                    placeholder: `예) 학번@${selectedUniversity === '경기과학기술대학교' ? 'office.gtec.ac.kr' : 'tukorea.ac.kr'}`,
                  },
                ],
              },
            ],
          },
        });
      }
      console.log('Unknown message component custom_id:', customId);
      // 알 수 없는 드롭다운 또는 버튼 클릭 시, 사용자에게만 보이는 임시 메시지로 응답 (타임아웃 방지)
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '알 수 없는 상호작용입니다.', flags: 64 }, // flags: 64는 ephemeral (사용자만 볼 수 있음)
      });
    }

    // --- 3. 모달 제출 처리 (`MODAL_SUBMIT`) ---
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      console.log(
        'Handling MODAL_SUBMIT. Custom ID:',
        interaction.data.custom_id,
      );
      const modalCustomId = interaction.data.custom_id;

      // --- 3.1 이메일 입력 모달 제출 처리 ---
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

        console.log(
          `Email modal submitted: University - ${selectedUniversity}, Email - ${email}.`,
        );

        // --- 3.1.1 이메일 형식 유효성 검사 ---
        let isValidEmailFormat = false;
        let expectedDomain = '';
        if (selectedUniversity === '경기과학기술대학교') {
          expectedDomain = 'office.gtec.ac.kr';
          isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@office\.gtec\.ac\.kr$/i.test(
            email,
          );
        } else if (selectedUniversity === '한국공학대학교') {
          expectedDomain = 'tukorea.ac.kr';
          isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@tukorea\.ac\.kr$/i.test(
            email,
          );
        }

        if (!isValidEmailFormat) {
          console.log(
            `Email format invalid for ${selectedUniversity}: ${email}`,
          );
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `이메일 형식이 맞지 않습니다. **${selectedUniversity}**의 올바른 이메일 형식(예: 학번@${expectedDomain})으로 다시 입력해주세요.`,
              flags: 64,
            },
          });
        }

        // --- 3.1.2 UnivCert API (인증 메일 전송) 호출 ---
        const univcertApiKey = env.UNIVCERT_API_KEY;
        if (!univcertApiKey) {
          console.error(
            'UNIVCERT_API_KEY is not set in Cloudflare Worker secrets.',
          );
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
          console.log(
            'Sending request to UnivCert API (certify):',
            JSON.stringify(univcertPayload),
          );
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
          console.log(
            'UnivCert API (certify) Response:',
            JSON.stringify(univcertResult),
          );

          if (univcertResponse.ok && univcertResult.success) {
            // --- 인증 메일 전송 성공: 인증번호 입력 모달 띄우기 ---
            console.log(
              'UnivCert certify successful. Showing verification code modal.',
            );
            return new JsonResponse({
              type: InteractionResponseType.MODAL,
              data: {
                // 인증번호 모달의 custom_id에 대학교와 이메일 정보를 포함 (쉼표로 구분)
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
          } else {
            // UnivCert certify 실패
            let errorMessage = '인증 메일 전송에 실패했습니다.';
            if (univcertResult.message) {
              errorMessage += `\n오류: ${univcertResult.message}`;
            } else {
              errorMessage += `\n알 수 없는 API 응답 오류.`;
            }
            console.error('UnivCert certify API error:', univcertResult);
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 메일 전송 실패!**\n\n${errorMessage}\n\n잠시 후 다시 시도하거나, 이메일 주소를 다시 확인해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          console.error('Error during UnivCert certify API call:', apiError);
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '인증 서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
              flags: 64,
            },
          });
        }
      }
      // --- 3.2 인증번호 입력 모달 제출 처리 ---
      else if (modalCustomId.startsWith('verify_code_modal_')) {
        // 모달 custom_id에서 대학교와 이메일 정보를 추출
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

        console.log(
          `Verification code modal submitted: University - ${selectedUniversity}, Email - ${email}, Code - ${verificationCode}.`,
        );

        // --- 3.2.1 UnivCert API (인증번호 확인) 호출 ---
        const univcertApiKey = env.UNIVCERT_API_KEY;
        if (!univcertApiKey) {
          console.error(
            'UNIVCERT_API_KEY is not set in Cloudflare Worker secrets.',
          );
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
          console.log(
            'Sending request to UnivCert API (certifycode):',
            JSON.stringify(verifyPayload),
          );
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
          console.log(
            'UnivCert API (certifycode) Response:',
            JSON.stringify(verifyResult),
          );

          if (verifyResponse.ok && verifyResult.success) {
            // --- 인증 완료! 역할 부여 로직 시작 ---
            console.log(
              `Authentication successful for ${email} at ${selectedUniversity}. Attempting to assign role.`,
            );

            // Discord API를 통해 사용자에게 역할 부여
            // 봇이 해당 서버에서 역할 관리 권한을 가지고 있어야 합니다.
            // env에 Discord 봇 토큰이 SECRETS 변수로 설정되어 있어야 합니다 (예: DISCORD_BOT_TOKEN)
            const discordBotToken = env.DISCORD_BOT_TOKEN;
            if (!discordBotToken) {
              console.error(
                'DISCORD_BOT_TOKEN is not set in Cloudflare Worker secrets.',
              );
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
            let roleName = ''; // 역할 이름도 메시지에 포함할 수 있도록
            if (selectedUniversity === '경기과학기술대학교') {
              roleIdToAssign = GTEC_ROLE;
              roleName = '경기과기대'; // 예시 역할 이름
            } else if (selectedUniversity === '한국공학대학교') {
              roleIdToAssign = TUK_ROLE;
              roleName = '한국공학대'; // 예시 역할 이름
            }

            if (!roleIdToAssign) {
              console.error(
                `Role ID not configured for ${selectedUniversity}.`,
              );
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `인증은 완료되었으나, **${selectedUniversity}** 역할 ID가 설정되지 않아 역할을 부여할 수 없습니다. 관리자에게 문의하세요.`,
                  flags: 64,
                },
              });
            }

            // Discord API: 길드 멤버에게 역할 추가 요청
            // PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}
            const guildId = interaction.guild_id; // 상호작용이 발생한 길드 ID
            const userId = interaction.member.user.id; // 상호작용을 한 사용자 ID

            console.log(
              `Attempting to assign role ${roleIdToAssign} to user ${userId} in guild ${guildId}.`,
            );
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
              console.log(
                `Role ${roleIdToAssign} successfully assigned to user ${userId}.`,
              );
              return new JsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `**인증 완료!**\n\n**${selectedUniversity}** 학생 역할(${roleName})이 성공적으로 부여되었습니다!`,
                  flags: 64,
                },
              });
            } else {
              console.error(
                `Failed to assign role ${roleIdToAssign} to user ${userId}:`,
                addRoleResponse.status,
                await addRoleResponse.text(),
              );
              // Discord API 오류 메시지 포함
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
            // UnivCert certifycode 실패
            let errorMessage = '인증번호가 올바르지 않습니다.';
            if (verifyResult.message) {
              errorMessage += `\n오류: ${verifyResult.message}`;
            } else {
              errorMessage += `\n알 수 없는 API 응답 오류.`;
            }
            console.error('UnivCert certifycode API error:', verifyResult);
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `**인증 실패!**\n\n${errorMessage}\n\n다시 확인하고 정확한 인증번호를 입력해주세요.`,
                flags: 64,
              },
            });
          }
        } catch (apiError) {
          console.error(
            'Error during UnivCert certifycode API call:',
            apiError,
          );
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                '인증 서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
              flags: 64,
            },
          });
        }
      }
      // --- 알 수 없는 모달 제출 (email_modal_ 또는 verify_code_modal_이 아닌 경우) ---
      else {
        console.log('Unknown modal custom_id:', interaction.data.custom_id);
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '알 수 없는 모달 상호작용입니다.', flags: 64 },
        });
      }
    }

    // 예상치 못한 상호작용 타입인 경우 (APPLICATION_COMMAND, MESSAGE_COMPONENT, MODAL_SUBMIT 이외)
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
