<#ftl output_format="HTML">
<html>
<body style="margin:0;padding:0;background:#f7f8f9;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f8f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #d3d7dc;border-radius:8px;">

      <tr><td style="padding:28px 32px 4px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:18px;font-weight:700;color:#1f4d7a;">
        AoBPlatform
      </td></tr>

      <tr><td style="padding:8px 32px 16px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:700;color:#16181a;line-height:1.3;">
        Your practice has been approved
      </td></tr>

      <#-- ADDRESSED TO A PERSON. A message that asks somebody to enrol a
           credential and does not use their name reads exactly like the
           bulk mail it is trying not to be mistaken for. `firstName` can be
           empty -- Keycloak does not require it -- so there is a fallback
           rather than a stray comma. -->
      <tr><td style="padding:0 32px 12px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#16181a;">
        <#if user.firstName?? && user.firstName?has_content>Hi ${user.firstName},<#else>Hi,</#if>
      </td></tr>

      <tr><td style="padding:0 32px 16px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#16181a;">
        AoBPlatform records patient consent to bulk billing. Your account is protected by a
        <strong>passkey</strong> &mdash; your device plus your fingerprint, face or PIN. There is no password
        to choose and none to forget, which also means there is nothing for anyone to phish out of you.
      </td></tr>

      <tr><td style="padding:4px 32px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="background:#1f4d7a;border-radius:6px;">
            <a href="${link}" style="display:inline-block;padding:12px 22px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Set up your sign-in</a>
          </td>
        </tr></table>
      </td></tr>

      <#-- Shown in full as well as linked: people forward, paste and print, and
           a bare "click here" is exactly the shape of a phishing message. -->
      <tr><td style="padding:0 32px 16px;font-family:ui-monospace,'Cascadia Mono',Menlo,monospace;font-size:12px;line-height:1.6;color:#55595e;word-break:break-all;">
        <a href="${link}" style="color:#1f4d7a;">${link}</a>
      </td></tr>

      <tr><td style="padding:0 32px 20px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.65;color:#55595e;">
        That link works for ${linkExpirationFormatter(linkExpiration)} and can be used once.
      </td></tr>

      <tr><td style="padding:4px 32px;"><div style="height:1px;background:#d3d7dc;font-size:0;line-height:0;">&nbsp;</div></td></tr>

      <tr><td style="padding:20px 32px 4px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#55595e;">
        What to expect
      </td></tr>
      <tr><td style="padding:0 32px 16px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#16181a;">
        Your browser will ask you to create a passkey. On Windows the dialog should be headed
        <strong>Windows Security</strong> &mdash; if it offers to save to a password manager instead, choose
        the Windows Hello or security key option, or the passkey will not be able to sign you in afterwards.
      </td></tr>
      <tr><td style="padding:0 32px 20px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#16181a;">
        Set it up on the device you will actually use. A passkey is created where it is enrolled, and it does
        not travel by itself.
      </td></tr>

      <tr><td style="padding:0 32px 20px;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.65;color:#55595e;">
        <strong>If you were not expecting this,</strong> do not follow the link, and tell us. Nothing happens
        to your account unless somebody completes the enrolment.
      </td></tr>

      <#-- The footer is not decoration. We are asking somebody to click a link
           and enrol a credential, which is exactly what phishing asks for.
           Saying who we are, why they got it, and what we will never ask is
           what separates the two -- and the last line hands them a rule they
           can apply to the NEXT message, including one we did not send. -->
      <tr><td style="padding:16px 32px 28px;border-top:1px solid #d3d7dc;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.7;color:#6f747a;">
        <strong style="color:#16181a;">AoBPlatform</strong><br>
        Consent and compliance records for Medicare assignment of benefit.<br><br>
        You received this because this address was given as the practice administrator on an application to
        AoBPlatform, and that application has been approved.<br>
        We will never ask you for a password, a Medicare number, or bank details by email.
        We will never telephone you and ask you to read out a code.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
