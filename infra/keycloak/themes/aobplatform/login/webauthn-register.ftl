<#--
  Passkey enrolment, with a guidance panel beside the box.

  WHAT IS OURS AND WHAT IS KEYCLOAK'S. Everything inside `aob-register-main` is
  the stock keycloak.v2 template, unchanged: the same form, the same action, the
  same hidden fields, the same registerByWebAuthn script, the same buttons. The
  authentication flow reads that markup and nothing else. Our contribution is
  two wrapper divs and the <aside> after them, none of which the flow can see.

  Kept that way deliberately -- a login theme that throws breaks sign-in for
  every practitioner at once, and there is no password path to fall back to
  (hard rule 15). The narrower the diff against the stock template, the cheaper
  it is to re-check against the next Keycloak.

  WHY A PANEL AT ALL: see the header of theme.properties, and
  CRITICAL-ISSUES.md section 2. Every sentence lives in
  login/messages/messages_en.properties; there are none here.
-->
<#import "template.ftl" as layout>
<#import "password-commons.ftl" as passwordCommons>
<#import "buttons.ftl" as buttons>

<#--
  The platforms the panel covers, in the order they are offered. A key, not a
  label: the label is msg("aobPasskeyPlatform" + key) and the steps are
  msg("aobPasskeyStep" + key + n), so adding a platform is a new block in the
  properties file plus its key here.
-->
<#assign aobPlatforms = ["Windows", "Mac", "Android", "Ios"]>

<@layout.registrationLayout; section>
    <#if section = "title">
        title
    <#elseif section = "header">
        <span class="${properties.kcWebAuthnKeyIcon!}"></span>
        ${kcSanitize(msg("webauthn-registration-title"))?no_esc}
    <#elseif section = "form">

    <div class="aob-register-layout">
      <div class="aob-register-main">

        <form id="register" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <input type="hidden" id="clientDataJSON" name="clientDataJSON"/>
                <input type="hidden" id="attestationObject" name="attestationObject"/>
                <input type="hidden" id="publicKeyCredentialId" name="publicKeyCredentialId"/>
                <input type="hidden" id="authenticatorLabel" name="authenticatorLabel"/>
                <input type="hidden" id="transports" name="transports"/>
                <input type="hidden" id="error" name="error"/>
                <@passwordCommons.logoutOtherSessions/>
            </div>
        </form>

        <script type="module">
            import { registerByWebAuthn } from "${url.resourcesPath}/js/webauthnRegister.js";
            const registerButton = document.getElementById('registerWebAuthn');
            registerButton.addEventListener("click", function() {
                const input = {
                    challenge : '${challenge}',
                    userid : '${userid}',
                    username : '${username}',
                    signatureAlgorithms : [<#list signatureAlgorithms as sigAlg>${sigAlg?c},</#list>],
                    rpEntityName : '${rpEntityName}',
                    rpId : '${rpId}',
                    attestationConveyancePreference : '${attestationConveyancePreference}',
                    authenticatorAttachment : '${authenticatorAttachment}',
                    requireResidentKey : '${requireResidentKey}',
                    userVerificationRequirement : '${userVerificationRequirement}',
                    createTimeout : ${createTimeout},
                    excludeCredentialIds : '${excludeCredentialIds}',
                    initLabel : "${msg("webauthn-registration-init-label")?no_esc}",
                    initLabelPrompt : "${msg("webauthn-registration-init-label-prompt")?no_esc}",
                    errmsg : "${msg("webauthn-unsupported-browser-text")?no_esc}"
                };
                registerByWebAuthn(input);
            });
        </script>

        <div class="pf-v5-u-py-lg ${properties.kcFormClass!}">
            <@buttons.actionGroup>
                <@buttons.button id="registerWebAuthn" label="doRegisterSecurityKey" />
                <#if !isSetRetry?has_content && isAppInitiatedAction?has_content>
                    <form action="${url.loginAction}" id="kc-webauthn-settings-form" method="post">
                        <@buttons.button id="cancelWebAuthnAIA" name="cancel-aia" label="doCancel" class=["kcButtonSecondaryClass"]/>
                    </form>
                </#if>
            </@buttons.actionGroup>
        </div>

      </div><#-- /aob-register-main -->

      <#--
        THE PANEL MAY NOT BE ABLE TO BREAK ENROLMENT.

        FreeMarker aborts the whole page on an error, and the page it would
        abort is the only way anybody gets a credential in a realm with no
        password path (hard rule 15). So the aside is wrapped: if anything in
        it throws -- a message key that stopped being a number, a template edit
        made in a hurry -- the guidance vanishes and the form still renders.
        Keycloak logs the cause. Losing the help is a bad day; losing enrolment
        is a lockout.
      -->
      <#attempt>
      <aside class="aob-guidance" aria-labelledby="aob-guidance-title">
        <h2 class="aob-guidance__title" id="aob-guidance-title">${msg("aobPasskeyGuidanceTitle")}</h2>
        <p class="aob-guidance__intro">${msg("aobPasskeyGuidanceIntro")}</p>

        <#--
          A native <select> rather than a tab strip: it is focusable, arrow-key
          operable and screen-reader announced without a line of ARIA, and it
          stays a list of four when the panel is 280px wide on a phone.
          The sniffing below only PRESELECTS it -- every platform stays
          reachable, because the person setting a colleague up is often not on
          the colleague's machine.
        -->
        <div class="aob-guidance__picker">
          <label class="aob-guidance__picker-label" for="aob-platform">${msg("aobPasskeyPickerLabel")}</label>
          <select class="aob-guidance__picker-select" id="aob-platform">
            <#list aobPlatforms as p>
              <option value="${p}">${msg("aobPasskeyPlatform" + p)}</option>
            </#list>
          </select>
        </div>

        <#--
          All four render. The script hides three of them; with no script all
          four stay visible, each under its own heading -- worse looking, just
          as usable. Nothing here degrades to nothing.
        -->
        <#list aobPlatforms as p>
          <#--
            aobPasskeyStepCount<Platform> is the ONE message key that is read as
            a number rather than printed. A missing or non-numeric value would
            make ?number throw, so it is parsed defensively and a bad value
            renders an empty list instead. The properties file says the same
            thing; this is the half that holds when nobody read it.
          -->
          <#assign aobCountRaw = msg("aobPasskeyStepCount" + p)>
          <#attempt>
            <#assign aobStepCount = aobCountRaw?number>
          <#recover>
            <#assign aobStepCount = 0>
          </#attempt>
          <section class="aob-guidance__steps" data-aob-platform="${p}" aria-labelledby="aob-steps-${p}">
            <h3 class="aob-guidance__steps-title" id="aob-steps-${p}">${msg("aobPasskeyPlatform" + p)}</h3>
            <ol class="aob-guidance__list">
              <#if (aobStepCount > 0)>
                <#list 1..aobStepCount as n>
                  <li>${msg("aobPasskeyStep" + p + n?c)}</li>
                </#list>
              </#if>
            </ol>
            <p class="aob-guidance__note">
              <strong class="aob-guidance__note-label">${msg("aobPasskeyNoteLabel")}</strong>
              ${msg("aobPasskeyNote" + p)}
            </p>
          </section>
        </#list>

        <p class="aob-guidance__help">${msg("aobPasskeyGuidanceHelp")}</p>

        <script>
          // Presentation only: preselect a platform and hide the other three.
          // It touches nothing the registration form or its script owns, reads
          // no identifier, and logs nothing.
          (function () {
            var select = document.getElementById('aob-platform');
            var panels = document.querySelectorAll('[data-aob-platform]');
            if (!select || panels.length === 0) return;

            function show(key) {
              for (var i = 0; i < panels.length; i++) {
                panels[i].hidden = panels[i].getAttribute('data-aob-platform') !== key;
              }
            }

            // A hint, never a gate. A wrong guess costs one keystroke.
            function guess() {
              var ua = navigator.userAgent || '';
              var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
              if (/iPhone|iPad|iPod/i.test(ua)) return 'Ios';
              if (/Android/i.test(ua)) return 'Android';
              // An iPad on iPadOS 13+ says it is a Mac; the touch points give it away.
              if (/Mac/i.test(plat + ua) && (navigator.maxTouchPoints || 0) > 1) return 'Ios';
              if (/Mac/i.test(plat) || /Mac OS X/i.test(ua)) return 'Mac';
              return 'Windows';
            }

            select.value = guess();
            show(select.value);
            select.addEventListener('change', function () { show(select.value); });
          })();
        </script>
      </aside>
      <#recover>
      </#attempt>
    </div><#-- /aob-register-layout -->

    </#if>
</@layout.registrationLayout>
