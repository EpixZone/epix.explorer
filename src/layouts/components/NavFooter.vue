<template>
  <!-- footer -->
  <footer class="modern-card mt-8 py-6 px-6 text-sm">
    <div class="flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="flex items-center text-gray-600 dark:text-gray-400">
        &copy;&nbsp;{{ new Date().getFullYear() }}&nbsp;
        Made with&nbsp;
        <img src="../../assets/images/heart.svg" class="mx-1 w-4 h-4" alt="heart" />&nbsp;
        by&nbsp;
        <a class="text-epix-primary hover:text-epix-secondary font-semibold transition-colors duration-200"
           href="https://epix.zone" target="_blank" rel="noopener noreferrer">Epix</a>
        &nbsp;and&nbsp;
        <a class="text-epix-primary hover:text-epix-secondary font-semibold transition-colors duration-200"
           href="https://ping.pub/" target="_blank" rel="noopener noreferrer">Ping.Pub</a>
      </div>
      <div class="flex items-center space-x-6">
        <a class="text-gray-600 dark:text-gray-400 hover:text-epix-primary font-medium transition-colors duration-200"
           href="https://github.com/EpixZone/epix.explorer/blob/master/LICENSE" target="_blank" rel="noopener noreferrer">
          License
        </a>
        <a class="text-gray-600 dark:text-gray-400 hover:text-epix-primary font-medium transition-colors duration-200"
           href="https://github.com/EpixZone/epix.explorer" target="_blank" rel="noopener noreferrer">
          Github
        </a>
      </div>
    </div>
  </footer>
</template>